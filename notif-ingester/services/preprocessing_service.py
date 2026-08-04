import logging
import json
import os
import uuid
from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime, timezone
from models.phone_hook import PhoneHookMessage
from services.llm_provider import make_provider
from repositories.prompt_debug_repository import IPromptDebugRepository, NoOpPromptDebugRepository
from models.prompt_debug_log import PromptDebugLog


@dataclass
class ExtractedAccountInfo:
    """Information extracted from raw notification text"""
    account_numbers: List[str]
    account_names: List[str]
    application: str
    potential_vendor_names: List[str]


class PreprocessingService:
    """Service for extracting account information and vendor hints from raw text before AI classification"""
    
    # AI prompt for extracting account/vendor information
    EXTRACTION_PROMPT = """
    You are a financial data extraction assistant. Extract ALL account identifiers, vendor names, and transaction details from this notification text.
    
    Notification: {raw_msg}
    
    Extract the following information:
    1. **Account Numbers**: Any account/card/wallet numbers mentioned (e.g., "1234", "****5678", "0917****")
    2. **Account Names**: Any account holder/merchant/person names mentioned (e.g., "John Doe", "Merchant Name")
    3. **Potential Vendor Names**: Any store/merchant/business names mentioned
    
    CRITICAL FILTERING RULES:
    - If this appears to be a FUND TRANSFER between accounts (e.g., bank transfer, e-wallet transfer, payment to another person):
      - DO NOT include bank names (e.g., BPI, BDO, UnionBank), e-wallet names (e.g., GCash, Maya), or financial institution names
      - For transfers, the vendor should be the PERSON or BUSINESS receiving the money, not the bank/wallet
    
    Return ONLY valid JSON matching this schema:
    {{
      "account_numbers": ["string"],
      "account_names": ["string"],
      "potential_vendor_names": ["string"]
    }}
    """
    
    def __init__(self, debug_repo: Optional[IPromptDebugRepository] = None):
        self.logger = logging.getLogger(__name__)
        self.extraction_provider = make_provider("CLASSIFICATION")
        self._debug_repo = debug_repo or NoOpPromptDebugRepository()
        self._prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
    
    async def extract_with_ai(self, text: str) -> Dict:
        """Use AI to extract account/vendor information from text"""
        prompt = self.EXTRACTION_PROMPT.format(raw_msg=text)
        response_text = ""
        in_tok, out_tok = None, None
        try:
            response_text, in_tok, out_tok = await self.extraction_provider.generate(
                prompt=prompt,
                json_mode=True,
                temperature=0.1
            )
            
            data = json.loads(response_text)
            return data
            
        except Exception as e:
            self.logger.error(f"AI extraction failed: {e}")
            response_text = response_text or str(e)
            return {
                "account_numbers": [],
                "account_names": [],
                "potential_vendor_names": []
            }
        finally:
            if self._prompt_debug:
                await self._debug_log(
                    call_type="preprocess_extract",
                    prompt=prompt,
                    response_text=response_text,
                    input_tokens=in_tok,
                    output_tokens=out_tok
                )

    async def _debug_log(
        self,
        call_type: str,
        prompt: str,
        response_text: str,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None
    ) -> None:
        """Persist prompt debug log to CosmosDB and a local markdown file with YAML frontmatter."""
        try:
            response_json = json.loads(response_text)
        except Exception:
            response_json = None

        log = PromptDebugLog(
            call_type=call_type,
            provider=self.extraction_provider.provider_label,
            prompt=prompt,
            response=response_text,
            response_json=response_json,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

        await self._debug_repo.add_async(log)

        try:
            os.makedirs("debug_prompts", exist_ok=True)
            file_name = f"{call_type}_{uuid.uuid4().hex[:8]}.md"
            file_path = os.path.join("debug_prompts", file_name)
            
            yaml_lines = [
                "---",
                f"timestamp: '{log.timestamp.isoformat()}'",
                f"call_type: '{call_type}'",
                f"provider: '{log.provider}'",
                f"input_tokens: {input_tokens if input_tokens is not None else 'null'}",
                f"output_tokens: {output_tokens if output_tokens is not None else 'null'}",
                "---"
            ]
            yaml_header = "\n".join(yaml_lines)
            
            md_content = f"""{yaml_header}

# Prompt Debug Log: {call_type}

## Prompt
```text
{prompt}
```

## Response
```json
{response_text}
```
"""
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(md_content)
        except Exception as e:
            self.logger.warning("PROMPT_DEBUG local markdown write failed: %s", e)
    
    def extract_application(self, hook: PhoneHookMessage) -> str:
        """Extract application/sender name from hook payload"""
        app_name = hook.raw_payload.get("notif_pkg") or hook.raw_payload.get("sms_rcv_sender") or hook.raw_payload.get("sms_sender") or ""
        return app_name
    
    async def process_hook(self, hook: PhoneHookMessage) -> ExtractedAccountInfo:
        """Main method to extract all account information from a hook using AI"""
        text = hook.raw_msg
        
        self.logger.info(f"[PreprocessingService] Extracting account info from: {text[:100]}...")
        
        # Use AI for extraction
        extracted_data = await self.extract_with_ai(text)
        
        application = self.extract_application(hook)
        
        # Log what we found
        self.logger.info(f"[PreprocessingService] Found {len(extracted_data.get('account_numbers', []))} account numbers: {extracted_data.get('account_numbers', [])}")
        self.logger.info(f"[PreprocessingService] Found {len(extracted_data.get('account_names', []))} account names: {extracted_data.get('account_names', [])}")
        self.logger.info(f"[PreprocessingService] Found {len(extracted_data.get('potential_vendor_names', []))} potential vendor names: {extracted_data.get('potential_vendor_names', [])}")
        self.logger.info(f"[PreprocessingService] Application: {application}")
        
        return ExtractedAccountInfo(
            account_numbers=extracted_data.get("account_numbers", []),
            account_names=extracted_data.get("account_names", []),
            application=application,
            potential_vendor_names=extracted_data.get("potential_vendor_names", [])
        )