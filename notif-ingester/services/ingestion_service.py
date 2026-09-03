import os
import logging
import re
from datetime import datetime, timezone
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
                        rate = rates.get(to_curr) * 1.004
                        if rate is not None:
                            return f"Exchange Rate: 1 {from_curr} = {rate} {to_curr}"
        except Exception as e:
            logging.error(f"Failed to fetch exchange rate from {from_curr} to {to_curr}: {e}")
        return None

    def _get_runbook_id(self) -> str:
        """Return the CosmosDB Settings id for this pipeline's runbook. Override in subclasses."""
        return "runbook"

    def _use_is_financial_gate(self) -> bool:
        """Whether to run fast is_financial check before preprocessing. App & SMS = True, Email/Image = False."""
        return True

    def _get_relation_window_minutes(self) -> float:
        """Time window for amount-only relation matching. App/SMS = 5.0, Email = 60.0, Image = 1440.0."""
        return 5.0

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
    def _format_candidate_summary(self, cand: PendingIngestion, cand_time: Optional[datetime] = None, time_offset_str: str = "") -> str:
        app = (cand.notification_type or "notification").upper()
        amt_str = f"₱{cand.ai_parsed.amount:,.2f}" if (cand.ai_parsed and cand.ai_parsed.amount is not None) else "N/A"
        ref_str = f"Ref: {cand.ai_parsed.reference_number}" if (cand.ai_parsed and cand.ai_parsed.reference_number) else "No Ref"
        
        parts = [f"ID: {cand.id}", f"[{app}]", amt_str, ref_str]
        
        if cand_time:
            parts.append(f"Time: {cand_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
        if time_offset_str:
            parts.append(f"({time_offset_str})")

        sender_acc = cand.ai_parsed.sender_account_number if (cand.ai_parsed and cand.ai_parsed.sender_account_number) else None
        if not sender_acc and cand.raw_payload and isinstance(cand.raw_payload, dict):
            extracted = cand.raw_payload.get("extracted_info", {})
            accs = extracted.get("account_numbers", [])
            if accs:
                sender_acc = accs[0]
        if sender_acc:
            parts.append(f"Card/Acc: {sender_acc}")

        vendor_name = cand.ai_parsed.vendor.name if (cand.ai_parsed and cand.ai_parsed.vendor and cand.ai_parsed.vendor.name) else None
        if vendor_name:
            parts.append(f"Vendor: {vendor_name}")

        credit_acc = cand.ai_parsed.credit_account_id if (cand.ai_parsed and cand.ai_parsed.credit_account_id) else None
        if credit_acc:
            parts.append(f"CreditAccId: {credit_acc}")

        summary = cand.ai_parsed.summary if (cand.ai_parsed and cand.ai_parsed.summary) else cand.raw_msg
        if summary:
            # Keep summary concise
            clean_summary = summary.replace("\n", " ").strip()
            if len(clean_summary) > 80:
                clean_summary = clean_summary[:77] + "..."
            parts.append(f"Summary: \"{clean_summary}\"")

        return " | ".join(parts)

    async def _build_related_context_async(
        self,
        user_id: str,
        reference_number: Optional[str],
        amount: Optional[float],
        effective_time: datetime,
        exclude_id: Optional[str] = None
    ) -> str:
        """Query relations pre-classification and format human-readable context for AI."""
        if not reference_number and amount is None:
            return ""

        context_lines = []
        ref_num = (reference_number or "").strip()

        # 1. Check candidate pending ingestions
        candidates = await self._repo.find_candidates_for_relation_async(user_id, days_lookback=30)
        seen_signatures = set()
        matched_candidates = []

        for cand in candidates:
            if exclude_id and cand.id == exclude_id:
                continue

            cand_ref = (cand.ai_parsed.reference_number or "").strip() if cand.ai_parsed else ""
            cand_amount = cand.ai_parsed.amount if cand.ai_parsed else None
            cand_time = self._extract_effective_time(cand)

            # Deduplicate repeated identical candidates (e.g. repeated test imports)
            sig = (
                cand.notification_type,
                round(float(cand_amount), 2) if cand_amount is not None else None,
                cand_ref.lower(),
                cand_time.strftime("%Y-%m-%d %H:%M")
            )
            if sig in seen_signatures:
                continue

            is_definite = False
            is_possible = False
            time_offset_str = ""

            if ref_num and cand_ref and ref_num.lower() == cand_ref.lower():
                diff_secs = (effective_time - cand_time).total_seconds()
                time_diff_days = abs(diff_secs) / (24 * 3600)
                if time_diff_days <= 30:
                    is_definite = True
                    time_offset_str = f"{abs(int(diff_secs / 60))}m apart" if abs(diff_secs) < 3600 else f"{round(time_diff_days, 1)}d apart"

            if not is_definite and amount is not None and cand_amount is not None:
                if round(abs(float(amount)), 2) == round(abs(float(cand_amount)), 2):
                    diff_secs = (effective_time - cand_time).total_seconds()
                    time_diff_mins = abs(diff_secs) / 60.0
                    if time_diff_mins <= self._get_relation_window_minutes():
                        is_possible = True
                        time_offset_str = f"{abs(int(diff_secs))}s apart" if abs(diff_secs) < 60 else f"{round(time_diff_mins, 1)}m apart"

            if is_definite or is_possible:
                seen_signatures.add(sig)
                matched_candidates.append((is_definite, cand, cand_time, time_offset_str))

        # Sort: Definite first, then by time closest to effective_time, limit to top 5
        matched_candidates.sort(key=lambda x: (not x[0], abs((effective_time - x[2]).total_seconds())))
        for is_definite, cand, cand_time, time_offset_str in matched_candidates[:5]:
            summary = self._format_candidate_summary(cand, cand_time, time_offset_str)
            if is_definite:
                context_lines.append(f"- [DEFINITE MATCH (Same Ref)] {summary}")
            else:
                context_lines.append(f"- [POSSIBLE MATCH (Same Amount)] {summary}")

        # 2. Check confirmed ledger entries (60 min lookback catches email-first gap)
        confirmed_matches = await self._finance_api_service.search_confirmed_ledger_entries_async(
            user_id=user_id,
            reference_number=ref_num if ref_num else None,
            amount=amount,
            around_time=effective_time,
            window_minutes=60
        )
        if confirmed_matches:
            for cm in confirmed_matches[:5]:
                t_id = cm.get("transaction_id") or "unknown"
                m_type = cm.get("match_type") or "reference_number or amount"
                t_date = cm.get("date") or ""
                t_desc = cm.get("description") or cm.get("notes") or ""
                context_lines.append(f"- [CONFIRMED TRANSACTION MATCH] ID: {t_id} | Date: {t_date} | Matched via: {m_type} | Desc: {t_desc}")

        return "\n".join(context_lines)

    async def _classify_hook_async(self, hook: PhoneHookMessage, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id: str = None, connection_id: str = None, stream_reasoning: bool = True, exchange_rate_info: str = "", user_corrections: Optional[dict] = None, related_context: str = "", extracted_info = None) -> 'AiParsedData':
        return await self._ai_service.classify_async(
            hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id=operation_id, connection_id=connection_id, stream_reasoning_to_client=stream_reasoning, exchange_rate_info=exchange_rate_info, user_corrections=user_corrections, related_context=related_context
        )

    def _extract_effective_time(self, ingestion: PendingIngestion) -> datetime:
        """Extract the effective datetime from ai_parsed.date, raw_payload.timestamp, or received_at."""
        from services.date_utils import parse_iso_or_local_to_utc
        if ingestion.ai_parsed and ingestion.ai_parsed.date:
            parsed_dt = parse_iso_or_local_to_utc(ingestion.ai_parsed.date)
            if parsed_dt:
                return parsed_dt

        raw_ts = ingestion.raw_payload.get("timestamp") if ingestion.raw_payload else None
        if raw_ts is not None:
            parsed_dt = parse_iso_or_local_to_utc(raw_ts)
            if parsed_dt:
                return parsed_dt

        parsed_dt = parse_iso_or_local_to_utc(ingestion.received_at)
        return parsed_dt or datetime.now(timezone.utc)

    async def detect_and_link_relations_async(self, ingestion: PendingIngestion) -> None:
        """
        Detect relations with other pending/recent ingestions and confirmed transactions.
        Back-ports links to matched existing pending ingestions.
        """
        if not ingestion.ai_parsed or ingestion.ai_parsed.is_financial is False:
            return

        ref_num = (ingestion.ai_parsed.reference_number or "").strip()
        amount = ingestion.ai_parsed.amount
        eff_time = self._extract_effective_time(ingestion)

        # 1. Query candidate pending/recent ingestions for this user
        candidates = await self._repo.find_candidates_for_relation_async(ingestion.user_id, days_lookback=30)
        
        definite_ids = set(ingestion.related_ingestion_ids or [])
        possible_ids = set(ingestion.possible_related_ingestion_ids or [])
        
        backport_updates = []

        for candidate in candidates:
            if candidate.id == ingestion.id:
                continue

            cand_ref = (candidate.ai_parsed.reference_number or "").strip() if candidate.ai_parsed else ""
            cand_amount = candidate.ai_parsed.amount if candidate.ai_parsed else None
            cand_time = self._extract_effective_time(candidate)

            is_definite = False
            is_possible = False

            # Check Criteria 1: Reference Number Match (within 30 days)
            if ref_num and cand_ref and ref_num.lower() == cand_ref.lower():
                time_diff_days = abs((eff_time - cand_time).total_seconds()) / (24 * 3600)
                if time_diff_days <= 30:
                    is_definite = True

            # Check Criteria 2: Amount & time window
            if not is_definite and amount is not None and cand_amount is not None:
                if round(abs(float(amount)), 2) == round(abs(float(cand_amount)), 2):
                    time_diff_mins = abs((eff_time - cand_time).total_seconds()) / 60.0
                    if time_diff_mins <= self._get_relation_window_minutes():
                        is_possible = True

            if is_definite:
                definite_ids.add(candidate.id)
                # Prepare backport for candidate
                cand_definite = set(candidate.related_ingestion_ids or [])
                if ingestion.id not in cand_definite:
                    cand_definite.add(ingestion.id)
                    candidate.related_ingestion_ids = list(cand_definite)
                    backport_updates.append(candidate)
            elif is_possible:
                possible_ids.add(candidate.id)
                # Prepare backport for candidate
                cand_possible = set(candidate.possible_related_ingestion_ids or [])
                if ingestion.id not in cand_possible:
                    cand_possible.add(ingestion.id)
                    candidate.possible_related_ingestion_ids = list(cand_possible)
                    backport_updates.append(candidate)

        ingestion.related_ingestion_ids = list(definite_ids)
        ingestion.possible_related_ingestion_ids = list(possible_ids)

        # 2. Check against Confirmed Transactions / Ledger Entries (60 min lookback)
        confirmed_matches = await self._finance_api_service.search_confirmed_ledger_entries_async(
            user_id=ingestion.user_id,
            reference_number=ref_num if ref_num else None,
            amount=amount,
            around_time=eff_time,
            window_minutes=60
        )

        if confirmed_matches:
            tx_ids = set(ingestion.related_transaction_ids or [])
            for cm in confirmed_matches:
                t_id = cm.get("transaction_id")
                if t_id:
                    tx_ids.add(t_id)
            ingestion.related_transaction_ids = list(tx_ids)
            ingestion.has_possible_confirmed_match = len(tx_ids) > 0

        # Execute back-ports to CosmosDB
        for cand_to_update in backport_updates:
            try:
                await self._repo.update_async(cand_to_update)
            except Exception as e:
                logging.warning(f"Failed to back-port relation link to {cand_to_update.id}: {e}")

    async def process_hook_async(self, hook: PhoneHookMessage) -> PendingIngestion:
        # 1. Embed raw message
        logging.info(f"[process_hook_async] 1. Embedding raw message for hook {hook.id}...")
        query_embedding = await self._embedding_service.embed_async(hook.raw_msg)

        # 2. Vector search: find top-5 similar past transactions
        logging.info("[process_hook_async] 2. Performing vector search...")
        similar_vectors = await self._vector_service.find_similar_async(
            query_embedding, hook.user_id, top_k=5
        )
        top_score = similar_vectors[0][1] if similar_vectors else 0.0

        # 3. Fetch accounts and runbook
        logging.info("[process_hook_async] 3. Fetching accounts...")
        accounts = await self._finance_api_service.get_accounts_async(hook.user_id)
        vendors = await self._finance_api_service.get_vendors_async(hook.user_id)
        
        logging.info("[process_hook_async] 3b. Fetching runbook...")
        runbook_content = await self._finance_api_service.get_runbook_content_async(hook.user_id, self._get_runbook_id())
        if not runbook_content:
            runbook_content = self._ai_service.get_default_runbook_content()
        
        # 3.4 is_financial gate (fast pre-check for App & SMS)
        if self._use_is_financial_gate():
            is_financial = await self._ai_service.is_financial_transaction_async(hook)
            if not is_financial:
                logging.info(f"[process_hook_async] Hook {hook.id} determined non-financial by gate. Short-circuiting.")
                ingestion = PendingIngestion(
                    user_id=hook.user_id,
                    hook_id=hook.id,
                    received_at=hook.received_at,
                    raw_payload=hook.raw_payload,
                    raw_msg=hook.raw_msg,
                    ai_parsed=AiParsedData(is_financial=False),
                    similarity_score=top_score,
                    top_matches=[],
                    status="NonFinancial",
                    ttl=7 * 24 * 60 * 60,
                    month_key=hook.month_key,
                    partition_key=hook.partition_key,
                    notification_type=hook.notification_type
                )
                return await self._repo.add_async(ingestion)

        # 3.5 Preprocessing: extract account numbers and potential vendor names
        logging.info("[process_hook_async] 3.5 Preprocessing raw message...")
        if hook.raw_payload and "extracted_info" in hook.raw_payload:
            logging.info("[process_hook_async] Bypassing extraction AI call (already present in payload)")
            extracted_info_dict = hook.raw_payload["extracted_info"]
            raw_amt = extracted_info_dict.get("amount")
            parsed_amount = None
            if raw_amt is not None:
                try:
                    parsed_amount = float(raw_amt)
                except (ValueError, TypeError):
                    parsed_amount = None

            extracted_info = ExtractedAccountInfo(
                account_numbers=extracted_info_dict.get("account_numbers", []),
                account_names=extracted_info_dict.get("account_names", []),
                application=self._preprocessing_service.extract_application(hook),
                potential_vendor_names=extracted_info_dict.get("potential_vendor_names", []),
                currency=extracted_info_dict.get("currency", "PHP") or "PHP",
                reference_number=extracted_info_dict.get("reference_number"),
                amount=parsed_amount,
                date=extracted_info_dict.get("date"),
                is_multi_order=bool(extracted_info_dict.get("is_multi_order", False))
            )
        else:
            extracted_info = await self._preprocessing_service.process_hook(hook)
            if hook.raw_payload is not None:
                hook.raw_payload.setdefault("extracted_info", {})
                hook.raw_payload["extracted_info"]["is_multi_order"] = extracted_info.is_multi_order
                hook.raw_payload["extracted_info"]["currency"] = extracted_info.currency
                if extracted_info.reference_number:
                    hook.raw_payload["extracted_info"]["reference_number"] = extracted_info.reference_number
                if extracted_info.amount is not None:
                    hook.raw_payload["extracted_info"]["amount"] = extracted_info.amount
                if extracted_info.date:
                    hook.raw_payload["extracted_info"]["date"] = extracted_info.date
                if extracted_info.account_numbers:
                    hook.raw_payload["extracted_info"]["account_numbers"] = extracted_info.account_numbers
                if extracted_info.account_names:
                    hook.raw_payload["extracted_info"]["account_names"] = extracted_info.account_names
                if extracted_info.potential_vendor_names:
                    hook.raw_payload["extracted_info"]["potential_vendor_names"] = extracted_info.potential_vendor_names
        
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

        # 3.6 Early relation lookup pre-classification
        logging.info("[process_hook_async] 3.6 Searching for related transactions pre-classify...")
        from services.date_utils import parse_iso_or_local_to_utc
        pre_effective_time = parse_iso_or_local_to_utc(extracted_info.date)
        if not pre_effective_time and hook.raw_payload and hook.raw_payload.get("timestamp"):
            pre_effective_time = parse_iso_or_local_to_utc(hook.raw_payload["timestamp"])
        if not pre_effective_time:
            pre_effective_time = parse_iso_or_local_to_utc(hook.received_at) or datetime.now(timezone.utc)

        related_context = await self._build_related_context_async(
            user_id=hook.user_id,
            reference_number=extracted_info.reference_number,
            amount=extracted_info.amount,
            effective_time=pre_effective_time,
            exclude_id=hook.id
        )

        # 4. Classify via LLM with vendor match context and related transactions context
        logging.info("[process_hook_async] 4. Classifying via LLM with vendor context and relations...")
        ai_parsed = await self._classify_hook_async(
            hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches, stream_reasoning=False, exchange_rate_info=exchange_rate_info, related_context=related_context, extracted_info=extracted_info
        )

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
                if ingestion.ai_parsed:
                    ingestion.ai_parsed.notes = f"Auto-confirm failed: {str(e)}"
                logging.warning(f"Auto-confirm failed for hook {hook.id}: {e}")
        else:
            ingestion.status = "Pending"

        # 6.5 Detect & link related transactions across notification types and confirmed records
        await self.detect_and_link_relations_async(ingestion)

        # 7. Save
        return await self._repo.add_async(ingestion)

    async def reclassify_ingestion_async(self, ingestion_id: str, user_id: str, operation_id: str = None, connection_id: str = None, stream_reasoning: bool = True, user_corrections: Optional[dict] = None) -> PendingIngestion:
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

        # 3.6 Early relation context
        eff_time = self._extract_effective_time(ingestion)
        related_context = await self._build_related_context_async(
            user_id=user_id,
            reference_number=extracted_info.reference_number or (ingestion.ai_parsed.reference_number if ingestion.ai_parsed else None),
            amount=extracted_info.amount or (ingestion.ai_parsed.amount if ingestion.ai_parsed else None),
            effective_time=eff_time,
            exclude_id=ingestion.id
        )

        # 4. Re-classify via LLM
        # Build a minimal hook-like object for classification
        from types import SimpleNamespace
        hook_like = SimpleNamespace(
            raw_msg=ingestion.raw_msg,
            raw_payload=ingestion.raw_payload,
            user_id=user_id
        )
        ai_parsed = await self._classify_hook_async(hook_like, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id=operation_id, connection_id=connection_id, stream_reasoning=stream_reasoning, exchange_rate_info=exchange_rate_info, user_corrections=user_corrections, related_context=related_context, extracted_info=extracted_info)

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

        if user_corrections:
            # User provided corrections on the Reclassify modal: keep the original ai_parsed
            # intact and stash the new refined output in ai_reclassified. user_confirmed is
            # left untouched — it is only written by the confirm/learn flow.
            ingestion.ai_reclassified = ai_parsed
        else:
            # Plain reclassify: regenerate the classification in place.
            ingestion.ai_parsed = ai_parsed
            ingestion.ai_reclassified = None
        ingestion.similarity_score = top_score
        ingestion.top_matches = matches
        ingestion.status = "Pending"

        # Detect and link relations on reclassification
        await self.detect_and_link_relations_async(ingestion)

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
