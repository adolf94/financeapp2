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
    currency: str = "PHP"


class PreprocessingService:
    """Service for extracting account information and vendor hints from raw text before AI classification"""
    
    # AI prompt for extracting account/vendor information
    EXTRACTION_PROMPT = """
    You are a financial data extraction assistant. Extract ALL account identifiers, vendor names, transaction details, and currency from this notification text.
    
    Notification: {raw_msg}
    
    Extract the following information:
    1. **Account Numbers**: Any account/card/wallet numbers mentioned (e.g., "1234", "****5678", "0917****")
    2. **Account Names**: Any account holder/merchant/person names mentioned (e.g., "John Doe", "Merchant Name")
    3. **Potential Vendor Names**: Any store/merchant/business names mentioned
    4. **Currency**: The 3-letter currency code of the transaction (e.g., PHP, USD, SGD). Default to 'PHP' if no currency is explicitly mentioned or if it is ambiguous.
    
    CRITICAL FILTERING RULES:
    - If this appears to be a FUND TRANSFER between accounts (e.g., bank transfer, e-wallet transfer, payment to another person):
      - DO NOT include bank names (e.g., BPI, BDO, UnionBank), e-wallet names (e.g., GCash, Maya), or financial institution names
      - For transfers, the vendor should be the PERSON or BUSINESS receiving the money, not the bank/wallet
    
    Return ONLY valid JSON matching this schema:
    {{
      "account_numbers": ["string"],
      "account_names": ["string"],
      "potential_vendor_names": ["string"],
      "currency": "string"
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
                temperature=0.1,
                thinking_budget=0
            )
            
            data = json.loads(response_text)
            return data
            
        except Exception as e:
            self.logger.error(f"AI extraction failed: {e}")
            response_text = response_text or str(e)
            return {
                "account_numbers": [],
                "account_names": [],
                "potential_vendor_names": [],
                "currency": "PHP"
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
    
    @staticmethod
    def extract_application_from_filename(filename: str) -> Optional[str]:
        """Infer application name from screenshot filename or package indicators."""
        if not filename:
            return None
        fn_lower = filename.lower()
        
        mappings = [
            ("gcash", "GCash"),
            ("com.globe.gcash", "GCash"),
            ("maya", "Maya"),
            ("paymaya", "Maya"),
            ("com.bpi.vybe", "Vybe"),
            ("vybe", "Vybe"),
            ("bpi", "BPI"),
            ("com.bpi", "BPI"),
            ("bdo", "BDO"),
            ("com.bdo", "BDO"),
            ("unionbank", "UnionBank"),
            ("com.unionbank", "UnionBank"),
            ("grab", "Grab"),
            ("com.grab", "Grab"),
            ("shopee", "Shopee"),
            ("com.shopee", "Shopee"),
            ("foodpanda", "Foodpanda"),
            ("gotyme", "GoTyme"),
            ("seabank", "SeaBank"),
            ("rcbc", "RCBC"),
            ("diskartech", "RCBC"),
            ("metrobank", "Metrobank"),
            ("lazada", "Lazada"),
            ("atome", "Atome"),
            ("com.atome", "Atome"),
        ]
        for pattern, app_name in mappings:
            if pattern in fn_lower:
                return app_name
        return None


    @classmethod
    def extract_image_lookups(cls, filename: str, description: str = "") -> list[str]:
        """Extract candidate lookup strings from filename, description, and inferred application."""
        import re
        candidates = set()
        
        # 1. Inferred app
        app = cls.extract_application_from_filename(filename)
        if app:
            candidates.add(app)
            
        # 2. Filename tokens
        if filename:
            clean_name = os.path.splitext(os.path.basename(filename))[0]
            tokens = re.split(r'[^a-zA-Z0-9]+', clean_name)
            stop_words = {"screenshot", "img", "image", "receipt", "photo", "jpg", "jpeg", "png", "webp", "upload", "devstoreaccount1"}
            for t in tokens:
                t_str = t.strip()
                if len(t_str) >= 3 and t_str.lower() not in stop_words and not re.match(r'^\d{8,}$', t_str):
                    candidates.add(t_str)
                    
        # 3. Description tokens & entities
        if description:
            acc_matches = re.findall(r'\b(?:\d{4}[-\s]?\d{4}[-\s]?\d{4}|\d{10,12}|09\d{9})\b', description)
            for m in acc_matches:
                candidates.add(m.replace(" ", "").replace("-", ""))
                
            desc_tokens = re.split(r'[^a-zA-Z0-9]+', description)
            common_stops = {"the", "and", "for", "with", "paid", "payment", "via", "from", "receipt", "note", "coffee", "team", "bought"}
            for t in desc_tokens:
                t_str = t.strip()
                if len(t_str) >= 3 and t_str.lower() not in common_stops:
                    candidates.add(t_str)
                    
        return list(candidates)


    def extract_application(self, hook: PhoneHookMessage) -> str:
        """Extract application/sender name from hook payload"""
        notif_pkg = hook.raw_payload.get("notif_pkg") or ""
        if notif_pkg:
            if "vybe" in notif_pkg.lower():
                return "Vybe"
            return notif_pkg

        app_name = hook.raw_payload.get("sms_rcv_sender") or hook.raw_payload.get("sms_sender") or ""
        if not app_name and hook.raw_payload.get("filename"):
            app_name = self.extract_application_from_filename(hook.raw_payload["filename"]) or ""
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
            potential_vendor_names=extracted_data.get("potential_vendor_names", []),
            currency=extracted_data.get("currency", "PHP") or "PHP"
        )