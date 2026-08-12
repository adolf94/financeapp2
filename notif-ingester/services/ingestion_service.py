import os
import logging
import re
from typing import Optional
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import PendingIngestion
from models.transaction_vector import TransactionVector
from repositories.ingestion_repository import IIngestionRepository
from services.embedding_service import EmbeddingService
from services.vector_service import VectorService
from services.ai_service import AiService
from services.finance_api_service import FinanceApiService
from services.preprocessing_service import PreprocessingService, ExtractedAccountInfo
from models.pending_ingestion import AiParsedData, AiVendorInfo

class IngestionService:
    def __init__(
        self,
        ingestion_repo: IIngestionRepository,
        embedding_service: EmbeddingService,
        vector_service: VectorService,
        ai_service: AiService,
        finance_api_service: FinanceApiService
    ):
        self._repo = ingestion_repo
        self._embedding_service = embedding_service
        self._vector_service = vector_service
        self._ai_service = ai_service
        self._finance_api_service = finance_api_service
        self._preprocessing_service = PreprocessingService(debug_repo=ai_service._debug_repo)
        self._auto_confirm_threshold = float(os.environ.get("AUTO_CONFIRM_THRESHOLD", "0.92"))

    async def _fetch_exchange_rate(self, from_curr: str, to_curr: str) -> Optional[str]:
        import aiohttp
        url = f"https://api.frankfurter.dev/v1/latest?from={from_curr}&to={to_curr}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=10) as response:
                    if response.status == 200:
                        data = await response.json()
                        rates = data.get("rates", {})
                        rate = rates.get(to_curr) * 0.004
                        if rate is not None:
                            return f"Exchange Rate: 1 {from_curr} = {rate} {to_curr}"
        except Exception as e:
            logging.error(f"Failed to fetch exchange rate from {from_curr} to {to_curr}: {e}")
        return None

    def _get_runbook_id(self) -> str:
        """Return the CosmosDB Settings id for this pipeline's runbook. Override in subclasses."""
        return "runbook"

    @property
    def ingestion_repo(self) -> IIngestionRepository:
        return self._repo

    def _has_masks(self, name: str) -> bool:
        if not name:
            return False
        name_lower = name.lower()
        if '*' in name:
            return True
        if 'xxx' in name_lower:
            return True
        if re.search(r'x{2,}', name_lower):
            return True
        if re.search(r'\d{4,}', name):
            return True
        return False

    def _build_lookups(self, ai_parsed, accounts: list[dict]) -> list[str]:
        # Extract ALL possible lookup strings from the AI classification
        raw_lookups = [
            ai_parsed.vendor.name if ai_parsed.vendor else None,
            getattr(ai_parsed, 'application', None),
            getattr(ai_parsed, 'recipient_account_name', None),
            getattr(ai_parsed, 'recipient_account_number', None),
            getattr(ai_parsed, 'sender_account_name', None),
            getattr(ai_parsed, 'sender_account_number', None)
        ]
        
        # Clean and filter lookups
        lookups = [loc.strip() for loc in raw_lookups if loc and isinstance(loc, str) and loc.strip()]
        
        stop_words = {
            "mastercard", "master-card", "visa", "gcash", "paymaya", "maya", 
            "credit card", "debit card", "bdo", "bpi", "unionbank", "metrobank",
            "instapay", "pesonet", "credit", "debit", "bank"
        }
        
        account_exclusions = set()
        if accounts:
            for acc in accounts:
                if acc.get("account_number"):
                    account_exclusions.add(str(acc["account_number"]).lower().strip())
                if acc.get("name"):
                    account_exclusions.add(str(acc["name"]).lower().strip())
                    
        clean_lookups = []
        for loc in lookups:
            loc_lower = loc.lower()
            if loc_lower in stop_words:
                continue
            if loc_lower in account_exclusions:
                continue
            clean_lookups.append(loc)
            
        return clean_lookups

    async def _classify_hook_async(self, hook: PhoneHookMessage, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id: str = None, connection_id: str = None, stream_reasoning: bool = True, exchange_rate_info: str = "") -> 'AiParsedData':
        """Classify a webhook and extract data."""
        return await self._ai_service.classify_async(hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id=operation_id, connection_id=connection_id, stream_reasoning_to_client=stream_reasoning, exchange_rate_info=exchange_rate_info)

    async def _apply_vendor_matching(self, ai_parsed: 'AiParsedData', vendors: list, accounts: list, lookups: list, user_id: str) -> None:
        """Apply vendor matching logic in-place on ai_parsed. Shared between process_hook_async and reclassify_ingestion_async."""
        if not ai_parsed.vendor:
            ai_parsed.vendor = AiVendorInfo()

        existing_vendor_names = {}
        if vendors:
            for v in vendors:
                if isinstance(v, dict) and v.get("name"):
                    existing_vendor_names[v.get("name").lower().strip()] = v.get("name")
                elif isinstance(v, str):
                    existing_vendor_names[v.lower().strip()] = v

        target_vendor = (ai_parsed.vendor.name or "").strip()

        string_match_name = None
        if target_vendor.lower() in existing_vendor_names:
            string_match_name = existing_vendor_names[target_vendor.lower()]

        matched_vendor, matched_lookups = await self._finance_api_service.search_vendors_by_lookups_async(user_id, lookups)
 
        db_lookups = [l for l in matched_lookups if l]
        ai_lookups = ai_parsed.vendor.lookups or []
        new_lookups = list(set([l for l in ai_lookups if l and l not in db_lookups]))
 
        if matched_vendor:
            ai_parsed.vendor.name = matched_vendor
            ai_parsed.vendor.matched = True
            ai_parsed.vendor.is_recommendation = False
            ai_parsed.vendor.lookups = db_lookups
            ai_parsed.vendor.new_lookups = new_lookups
        elif string_match_name:
            ai_parsed.vendor.name = string_match_name
            ai_parsed.vendor.matched = True
            ai_parsed.vendor.is_recommendation = False
            ai_parsed.vendor.lookups = db_lookups
            ai_parsed.vendor.new_lookups = new_lookups
        else:
            ai_parsed.vendor.matched = False
            ai_parsed.vendor.is_recommendation = True
            ai_parsed.vendor.lookups = []
            ai_parsed.vendor.new_lookups = list(set([l for l in (db_lookups + ai_lookups) if l]))
 
            if self._has_masks(ai_parsed.vendor.name):
                ai_parsed.vendor.matched = False
            else:
                if ai_parsed.confidence and ai_parsed.confidence >= self._auto_confirm_threshold and ai_parsed.debit_account_id and ai_parsed.credit_account_id and ai_parsed.vendor.name:
                    await self._finance_api_service.ensure_vendor_and_lookups_async(user_id, ai_parsed.vendor.name, lookups, ai_parsed.vendor.type)
                    ai_parsed.vendor.matched = True
                    ai_parsed.vendor.is_recommendation = False
                    ai_parsed.vendor.lookups = db_lookups
                    ai_parsed.vendor.new_lookups = new_lookups

    async def process_hook_async(self, hook: PhoneHookMessage) -> PendingIngestion:
        logging.info("[process_hook_async] Starting...")
        
        # 0. Quick AI check if it's a financial transaction
        logging.info("[process_hook_async] 0. Checking if financial transaction...")
        
        is_financial = await self._ai_service.is_financial_transaction_async(hook)
        if not is_financial:
            logging.info("[process_hook_async] Not a financial transaction. Skipping heavy extraction.")
            # Create a basic AiParsedData with is_financial=False
            ai_parsed = AiParsedData(is_financial=False)
            
            ingestion = PendingIngestion(
                user_id=hook.user_id,
                hook_id=hook.id,
                received_at=hook.received_at,
                raw_payload=hook.raw_payload,
                raw_msg=hook.raw_msg,
                ai_parsed=ai_parsed,
                similarity_score=0.0,
                top_matches=[],
                month_key=hook.month_key,
                partition_key=hook.partition_key,
                notification_type=hook.notification_type
            )
            ingestion.status = "NonFinancial"
            ingestion.ttl = 7 * 24 * 60 * 60  # 7 days
            return await self._repo.add_async(ingestion)

        # 1. Embed raw_msg
        logging.info("[process_hook_async] 1. Embedding raw msg...")
        query_embedding = await self._embedding_service.embed_async(hook.raw_msg)
        
        # 2. Find similar past transactions
        logging.info("[process_hook_async] 2. Finding similar transactions...")
        similar_vectors = await self._vector_service.find_similar_async(
            query_embedding, hook.user_id, top_k=5
        )
        top_score = similar_vectors[0][1] if similar_vectors else 0.0

        # 3. Fetch accounts and runbook
        logging.info("[process_hook_async] 3. Fetching accounts...")
        accounts = await self._finance_api_service.get_accounts_async(hook.user_id)
        
        logging.info("[process_hook_async] 3b. Fetching runbook...")
        runbook_content = await self._finance_api_service.get_runbook_content_async(hook.user_id, self._get_runbook_id())
        if not runbook_content:
            runbook_content = self._ai_service.get_default_runbook_content()

        # 3c. Fetch vendors...
        logging.info("[process_hook_async] 3c. Fetching vendors...")
        vendors = await self._finance_api_service.get_vendors_async(hook.user_id)
        
        # 3d. Pre-process notification to extract account info and find vendor matches
        logging.info("[process_hook_async] 3d. Pre-processing notification...")
        if "extracted_info" in hook.raw_payload:
            logging.info("[process_hook_async] Bypassing extraction AI call (already present in payload)")
            extracted_info_dict = hook.raw_payload["extracted_info"]
            extracted_info = ExtractedAccountInfo(
                account_numbers=extracted_info_dict.get("account_numbers", []),
                account_names=extracted_info_dict.get("account_names", []),
                application=self._preprocessing_service.extract_application(hook),
                potential_vendor_names=extracted_info_dict.get("potential_vendor_names", []),
                currency=extracted_info_dict.get("currency", "PHP") or "PHP"
            )
        else:
            extracted_info = await self._preprocessing_service.process_hook(hook)
        
        # Build lookup values from extracted info for vendor matching
        pre_lookups = []
        pre_lookups.extend(extracted_info.account_numbers)
        pre_lookups.extend(extracted_info.account_names)
        pre_lookups.extend(extracted_info.potential_vendor_names)
        pre_lookups.append(extracted_info.application)
        
        # Search for vendor matches using extracted info
        vendor_matches = await self._finance_api_service.search_all_vendor_matches_by_lookups_async(
            hook.user_id, pre_lookups
        )
        
        exchange_rate_info = ""
        if extracted_info.currency and extracted_info.currency.upper().strip() != "PHP":
            rate_str = await self._fetch_exchange_rate(extracted_info.currency.upper().strip(), "PHP")
            if rate_str:
                exchange_rate_info = f"\n{rate_str}\n"

        # 4. Classify via LLM with vendor match context
        logging.info("[process_hook_async] 4. Classifying via LLM with vendor context...")
        ai_parsed = await self._classify_hook_async(
            hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches, stream_reasoning=False, exchange_rate_info=exchange_rate_info
        )

        # 4.5 Automatically map vendor from lookups or string match
        lookups = self._build_lookups(ai_parsed, accounts)
        await self._apply_vendor_matching(ai_parsed, vendors, accounts, lookups, hook.user_id)

        # 5. Create PendingIngestion
        matches = []
        for v, score in similar_vectors:
            v_dict = v if isinstance(v, dict) else (v.model_dump() if hasattr(v, 'model_dump') else getattr(v, '__dict__', {}))
            matches.append({
                "vendor": v_dict.get("vendor"),
                "category": v_dict.get("category"),
                "debit_account_id": v_dict.get("debit_account_id"),
                "credit_account_id": v_dict.get("credit_account_id"),
                "description": v_dict.get("summary"),
                "score": score
            })

        ingestion = PendingIngestion(
            user_id=hook.user_id,
            hook_id=hook.id,
            received_at=hook.received_at,
            raw_payload=hook.raw_payload,
            raw_msg=hook.raw_msg,
            ai_parsed=ai_parsed,
            similarity_score=top_score,
            top_matches=matches,
            month_key=hook.month_key,
            partition_key=hook.partition_key,
            notification_type=hook.notification_type
        )

        # 6. Auto-confirm logic
        is_confident = (
            ai_parsed.confidence is not None
            and ai_parsed.confidence >= self._auto_confirm_threshold
            and ai_parsed.vendor is not None
            and ai_parsed.vendor.matched
            and ai_parsed.debit_account_id
            and ai_parsed.credit_account_id
        )

        if ai_parsed.is_financial is False:
            ingestion.status = "NonFinancial"
            ingestion.ttl = 7 * 24 * 60 * 60  # 7 days
        elif (top_score >= self._auto_confirm_threshold or is_confident) and ai_parsed.transaction_type:
            try:
                ai_parsed.is_auto_confirmed = True
                tx = await self._finance_api_service.create_transaction_async(ingestion)
                ingestion.status = "AutoConfirmed"
                ingestion.transaction_id = tx["id"]
                
                # Embed and learn immediately
                await self.embed_and_learn_async(ingestion)
            except Exception as e:
                # If auto-confirm fails, fallback to Pending
                ingestion.status = "Pending"
                ingestion.notes = f"Auto-confirm failed: {str(e)}"
        else:
            ingestion.status = "Pending"

        # 7. Save
        return await self._repo.add_async(ingestion)

    async def reclassify_ingestion_async(self, ingestion_id: str, user_id: str, operation_id: str = None, connection_id: str = None, stream_reasoning: bool = True) -> PendingIngestion:
        """Re-run AI classification on an existing PendingIngestion."""
        ingestion = await self._repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            raise ValueError("Ingestion not found")

        # 1. Re-embed raw_msg
        query_embedding = await self._embedding_service.embed_async(ingestion.raw_msg)

        # 2. Find similar past transactions
        similar_vectors = await self._vector_service.find_similar_async(
            query_embedding, user_id, top_k=3
        )
        top_score = similar_vectors[0][1] if similar_vectors else 0.0

        # 3. Fetch accounts, runbook, and vendors
        accounts = await self._finance_api_service.get_accounts_async(user_id)
        runbook_content = await self._finance_api_service.get_runbook_content_async(user_id, self._get_runbook_id())
        if not runbook_content:
            runbook_content = self._ai_service.get_default_runbook_content()
        vendors = await self._finance_api_service.get_vendors_async(user_id)

        # 3d. Pre-process notification to extract account info and find vendor matches
        logging.info("[reclassify_ingestion_async] Pre-processing notification...")
        # Create a minimal hook-like object for preprocessing
        from models.phone_hook import PhoneHookMessage
        hook_for_preprocess = PhoneHookMessage(
            id=ingestion.id,
            user_id=user_id,
            raw_msg=ingestion.raw_msg,
            raw_payload=ingestion.raw_payload,
            action="",
            status="",
            month_key="",
            partition_key=user_id,
            received_at=ingestion.received_at
        )
        extracted_info = await self._preprocessing_service.process_hook(hook_for_preprocess)
        
        # Build lookup values from extracted info for vendor matching
        pre_lookups = []
        pre_lookups.extend(extracted_info.account_numbers)
        pre_lookups.extend(extracted_info.account_names)
        pre_lookups.extend(extracted_info.potential_vendor_names)
        pre_lookups.append(extracted_info.application)
        
        # Search for vendor matches using extracted info
        vendor_matches = await self._finance_api_service.search_all_vendor_matches_by_lookups_async(
            user_id, pre_lookups
        )

        exchange_rate_info = ""
        if extracted_info.currency and extracted_info.currency.upper().strip() != "PHP":
            rate_str = await self._fetch_exchange_rate(extracted_info.currency.upper().strip(), "PHP")
            if rate_str:
                exchange_rate_info = f"\n{rate_str}\n"

        # 4. Re-classify via LLM
        # Build a minimal hook-like object for classification
        from types import SimpleNamespace
        hook_like = SimpleNamespace(
            raw_msg=ingestion.raw_msg,
            raw_payload=ingestion.raw_payload,
            user_id=user_id
        )
        ai_parsed = await self._classify_hook_async(hook_like, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id=operation_id, connection_id=connection_id, stream_reasoning=stream_reasoning, exchange_rate_info=exchange_rate_info)

        # 4.5 Automatically map vendor from lookups or string match
        lookups = self._build_lookups(ai_parsed, accounts)
        await self._apply_vendor_matching(ai_parsed, vendors, accounts, lookups, user_id)

        # 5. Update ingestion with new classification
        matches = []
        for v, score in similar_vectors:
            v_dict = v if isinstance(v, dict) else (v.model_dump() if hasattr(v, 'model_dump') else getattr(v, '__dict__', {}))
            matches.append({
                "vendor": v_dict.get("vendor"),
                "category": v_dict.get("category"),
                "debit_account_id": v_dict.get("debit_account_id"),
                "credit_account_id": v_dict.get("credit_account_id"),
                "description": v_dict.get("summary"),
                "score": score
            })

        ingestion.ai_parsed = ai_parsed
        ingestion.similarity_score = top_score
        ingestion.top_matches = matches
        ingestion.status = "Pending"

        await self._repo.update_async(ingestion)
        return ingestion

    async def learn_ingestion_async(self, ingestion_id: str, user_id: str, user_confirmed: dict = None) -> PendingIngestion:
        ingestion = await self._repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            raise ValueError("Ingestion not found")
            
        if user_confirmed:
            ingestion.user_confirmed = user_confirmed
        
        user_why = user_confirmed.get("user_why") if user_confirmed else None
        if user_why:
            # Note: We no longer auto-update the runbook here. 
            # It's queued for manual review in Settings > Runbook Review.
            pass

        # Learn from it
        await self.embed_and_learn_async(ingestion)
        
        # Update ingestion
        await self._repo.update_async(ingestion)
        return ingestion

    async def embed_and_learn_async(self, ingestion: PendingIngestion) -> None:
        parsed = ingestion.user_confirmed if ingestion.user_confirmed else ingestion.ai_parsed.model_dump()
        
        vendor_val = parsed.get("vendor", "")
        if isinstance(vendor_val, dict):
            vendor = vendor_val.get("name") or ""
        elif hasattr(vendor_val, "name"):
            vendor = getattr(vendor_val, "name") or ""
        else:
            vendor = str(vendor_val) if vendor_val else ""
            
        category = parsed.get("category", "")
        tx_type = parsed.get("transaction_type", "")
        
        # Fetch accounts to resolve human-readable names for embedding
        debit_id = parsed.get("debit_account_id")
        credit_id = parsed.get("credit_account_id")
        accounts = await self._finance_api_service.get_specific_accounts_async(ingestion.user_id, [debit_id, credit_id])
        
        debit_name = ""
        credit_name = ""
        for acc in accounts:
            if acc.get("id") == debit_id:
                debit_name = f"{acc.get('accountGroupName', '')} {acc.get('name', '')}"
            if acc.get("id") == credit_id:
                credit_name = f"{acc.get('accountGroupName', '')} {acc.get('name', '')}"
        
        details = [
            vendor,
            tx_type,
            debit_name,
            credit_name,
            parsed.get("recipient_account_name", ""),
            parsed.get("recipient_account_number", ""),
            parsed.get("sender_account_name", ""),
            parsed.get("sender_account_number", ""),
            parsed.get("application", "")
        ]
        
        # Filter out empty strings and join
        embed_text = " ".join([str(d).strip() for d in details if d and str(d).strip()])
        
        embedding = await self._embedding_service.embed_async(embed_text)
        
        vector = TransactionVector(
            user_id=ingestion.user_id,
            transaction_id=ingestion.transaction_id or "",
            vendor=vendor,
            category=category,
            summary=parsed.get("notes") or parsed.get("summary") or "",
            debit_account_id=parsed.get("debit_account_id", ""),
            credit_account_id=parsed.get("credit_account_id", ""),
            embed_text=embed_text,
            embedding=embedding
        )
        
        await self._vector_service.upsert_async(vector)

    async def generate_account_description_async(self, user_id: str, account_name: str, account_type: str, group_name: str, context: str = "") -> str:
        accounts = await self._finance_api_service.get_accounts_async(user_id)
        return await self._ai_service.generate_account_description_async(account_name, account_type, group_name, accounts, context)
