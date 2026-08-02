import os
import logging
import re
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import PendingIngestion
from models.transaction_vector import TransactionVector
from repositories.ingestion_repository import IIngestionRepository
from services.embedding_service import EmbeddingService
from services.vector_service import VectorService
from services.ai_service import AiService
from services.finance_api_service import FinanceApiService
from models.pending_ingestion import AiParsedData

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
        self._auto_confirm_threshold = float(os.environ.get("AUTO_CONFIRM_THRESHOLD", "0.92"))

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
        raw_lookups = [getattr(ai_parsed, 'vendor', None)]
        
        tx_type = getattr(ai_parsed, 'transaction_type', None)
        if tx_type == "Expense":
            raw_lookups.extend([
                getattr(ai_parsed, 'recipient_account_name', None),
                getattr(ai_parsed, 'recipient_account_number', None)
            ])
        elif tx_type == "Income":
            raw_lookups.extend([
                getattr(ai_parsed, 'sender_account_name', None),
                getattr(ai_parsed, 'sender_account_number', None)
            ])
        
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
                partition_key=hook.partition_key
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
        runbook_content = await self._finance_api_service.get_runbook_content_async(hook.user_id)
        if not runbook_content:
            runbook_content = self._ai_service.get_default_runbook_content()

        logging.info("[process_hook_async] 3c. Fetching vendors...")
        vendors = await self._finance_api_service.get_vendors_async(hook.user_id)

        # 4. Classify via LLM
        logging.info("[process_hook_async] 4. Classifying via LLM...")
        ai_parsed = await self._ai_service.classify_async(hook, similar_vectors, accounts, runbook_content, vendors)
        
        # 4.5 Automatically map vendor from lookups or string match
        existing_vendor_names = {}
        if vendors:
            for v in vendors:
                if isinstance(v, dict) and v.get("name"):
                    existing_vendor_names[v.get("name").lower().strip()] = v.get("name")
                elif isinstance(v, str):
                    existing_vendor_names[v.lower().strip()] = v

        target_vendor = (ai_parsed.vendor or "").strip()
        if not target_vendor and ai_parsed.suggested_vendor:
            target_vendor = (ai_parsed.suggested_vendor.name or "").strip()

        string_match_name = None
        if target_vendor.lower() in existing_vendor_names:
            string_match_name = existing_vendor_names[target_vendor.lower()]

        lookups = self._build_lookups(ai_parsed, accounts)
        matched_vendor = await self._finance_api_service.search_vendors_by_lookups_async(hook.user_id, lookups)
        
        if matched_vendor:
            ai_parsed.vendor = matched_vendor
            ai_parsed.vendor_matched = True
            ai_parsed.suggested_vendor = None
        elif string_match_name:
            ai_parsed.vendor = string_match_name
            ai_parsed.vendor_matched = True
            ai_parsed.suggested_vendor = None
        else:
            if ai_parsed.suggested_vendor and ai_parsed.suggested_vendor.name:
                ai_parsed.vendor = ai_parsed.suggested_vendor.name
                ai_parsed.vendor_type = ai_parsed.suggested_vendor.type or "Business"
            
            if self._has_masks(ai_parsed.vendor):
                ai_parsed.vendor_matched = False
            else:
                if ai_parsed.confidence and ai_parsed.confidence >= self._auto_confirm_threshold and ai_parsed.debit_account_id and ai_parsed.credit_account_id and ai_parsed.vendor:
                    await self._finance_api_service.ensure_vendor_and_lookups_async(hook.user_id, ai_parsed.vendor, lookups, ai_parsed.vendor_type)
                    ai_parsed.vendor_matched = True
                    if ai_parsed.suggested_vendor:
                        ai_parsed.suggested_vendor.is_created = True
                else:
                    ai_parsed.vendor_matched = False

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
            partition_key=hook.partition_key
        )

        # 6. Auto-confirm logic
        is_confident = (
            ai_parsed.confidence is not None
            and ai_parsed.confidence >= self._auto_confirm_threshold
            and ai_parsed.vendor_matched
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

    async def reclassify_ingestion_async(self, ingestion_id: str, user_id: str) -> PendingIngestion:
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
        runbook_content = await self._finance_api_service.get_runbook_content_async(user_id)
        if not runbook_content:
            runbook_content = self._ai_service.get_default_runbook_content()
        vendors = await self._finance_api_service.get_vendors_async(user_id)

        # 4. Re-classify via LLM
        # Build a minimal hook-like object for classification
        from types import SimpleNamespace
        hook_like = SimpleNamespace(
            raw_msg=ingestion.raw_msg,
            raw_payload=ingestion.raw_payload,
            user_id=user_id
        )
        ai_parsed = await self._ai_service.classify_async(hook_like, similar_vectors, accounts, runbook_content, vendors)


        # 4.5 Automatically map vendor from lookups or string match
        existing_vendor_names = {}
        if vendors:
            for v in vendors:
                if isinstance(v, dict) and v.get("name"):
                    existing_vendor_names[v.get("name").lower().strip()] = v.get("name")
                elif isinstance(v, str):
                    existing_vendor_names[v.lower().strip()] = v

        target_vendor = (ai_parsed.vendor or "").strip()
        if not target_vendor and ai_parsed.suggested_vendor:
            target_vendor = (ai_parsed.suggested_vendor.name or "").strip()

        string_match_name = None
        if target_vendor.lower() in existing_vendor_names:
            string_match_name = existing_vendor_names[target_vendor.lower()]

        lookups = self._build_lookups(ai_parsed, accounts)
        matched_vendor = await self._finance_api_service.search_vendors_by_lookups_async(user_id, lookups)
        
        if matched_vendor:
            ai_parsed.vendor = matched_vendor
            ai_parsed.vendor_matched = True
            ai_parsed.suggested_vendor = None
        elif string_match_name:
            ai_parsed.vendor = string_match_name
            ai_parsed.vendor_matched = True
            ai_parsed.suggested_vendor = None
        else:
            if ai_parsed.suggested_vendor and ai_parsed.suggested_vendor.name:
                ai_parsed.vendor = ai_parsed.suggested_vendor.name
                ai_parsed.vendor_type = ai_parsed.suggested_vendor.type or "Business"
            
            if self._has_masks(ai_parsed.vendor):
                ai_parsed.vendor_matched = False
            else:
                if ai_parsed.confidence and ai_parsed.confidence >= self._auto_confirm_threshold and ai_parsed.debit_account_id and ai_parsed.credit_account_id and ai_parsed.vendor:
                    await self._finance_api_service.ensure_vendor_and_lookups_async(user_id, ai_parsed.vendor, lookups, ai_parsed.vendor_type)
                    ai_parsed.vendor_matched = True
                    if ai_parsed.suggested_vendor:
                        ai_parsed.suggested_vendor.is_created = True
                else:
                    ai_parsed.vendor_matched = False

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
        
        vendor = parsed.get("vendor", "")
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
        embed_text = " ".join([d for d in details if d and str(d).strip()])
        
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
