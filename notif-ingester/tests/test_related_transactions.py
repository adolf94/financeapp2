import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
from models.pending_ingestion import PendingIngestion, AiParsedData
from services.ingestion_service import IngestionService

class TestRelatedTransactionsDetection(unittest.IsolatedAsyncioTestCase):
    @patch("services.ingestion_service.PreprocessingService")
    def setUp(self, mock_prep_cls):
        self.mock_repo = AsyncMock()
        self.mock_embedding_service = AsyncMock()
        self.mock_vector_service = AsyncMock()
        self.mock_ai_service = AsyncMock()
        self.mock_finance_api = AsyncMock()

        self.service = IngestionService(
            ingestion_repo=self.mock_repo,
            embedding_service=self.mock_embedding_service,
            vector_service=self.mock_vector_service,
            ai_service=self.mock_ai_service,
            finance_api_service=self.mock_finance_api
        )

    async def test_definite_relation_by_reference_number(self):
        now = datetime.now(timezone.utc)
        user_id = "user-123"

        # Current ingestion with reference number
        current_ing = PendingIngestion(
            id="ing-current",
            user_id=user_id,
            hook_id="hook-current",
            received_at=now,
            raw_payload={},
            raw_msg="SMS: Ref 98765 Paid 500",
            ai_parsed=AiParsedData(
                amount=500.0,
                reference_number="REF-98765",
                date=now
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="sms"
        )

        # Existing candidate pending ingestion with same reference number
        existing_candidate = PendingIngestion(
            id="ing-existing",
            user_id=user_id,
            hook_id="hook-existing",
            received_at=now - timedelta(hours=1),
            raw_payload={},
            raw_msg="Email: Receipt for order REF-98765",
            ai_parsed=AiParsedData(
                amount=500.0,
                reference_number="REF-98765",
                date=now - timedelta(hours=1)
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="email"
        )

        self.mock_repo.find_candidates_for_relation_async.return_value = [existing_candidate]
        self.mock_finance_api.search_confirmed_ledger_entries_async.return_value = []

        await self.service.detect_and_link_relations_async(current_ing)

        # Verify definite relationship linked on current ingestion
        self.assertIn("ing-existing", current_ing.related_ingestion_ids)
        self.assertEqual(len(current_ing.possible_related_ingestion_ids), 0)

        # Verify back-porting updated existing candidate
        self.mock_repo.update_async.assert_called_once()
        updated_candidate = self.mock_repo.update_async.call_args[0][0]
        self.assertIn("ing-current", updated_candidate.related_ingestion_ids)

    async def test_possible_relation_by_amount_and_time_window(self):
        now = datetime.now(timezone.utc)
        user_id = "user-123"

        current_ing = PendingIngestion(
            id="ing-current",
            user_id=user_id,
            hook_id="hook-current",
            received_at=now,
            raw_payload={},
            raw_msg="SMS: Paid 150.50 at Cafe",
            ai_parsed=AiParsedData(
                amount=150.50,
                reference_number=None,
                date=now
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="sms"
        )

        # Candidate within 3 minutes with same amount but no reference number
        existing_candidate = PendingIngestion(
            id="ing-app",
            user_id=user_id,
            hook_id="hook-app",
            received_at=now - timedelta(minutes=3),
            raw_payload={},
            raw_msg="Push: Payment of 150.50 successful",
            ai_parsed=AiParsedData(
                amount=150.50,
                reference_number=None,
                date=now - timedelta(minutes=3)
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="app"
        )

        self.mock_repo.find_candidates_for_relation_async.return_value = [existing_candidate]
        self.mock_finance_api.search_confirmed_ledger_entries_async.return_value = []

        await self.service.detect_and_link_relations_async(current_ing)

        # Verify possible relationship linked on current ingestion
        self.assertIn("ing-app", current_ing.possible_related_ingestion_ids)
        self.assertEqual(len(current_ing.related_ingestion_ids), 0)

        # Verify back-porting updated existing candidate
        self.mock_repo.update_async.assert_called_once()
        updated_candidate = self.mock_repo.update_async.call_args[0][0]
        self.assertIn("ing-current", updated_candidate.possible_related_ingestion_ids)

    async def test_no_relation_if_outside_time_window(self):
        now = datetime.now(timezone.utc)
        user_id = "user-123"

        current_ing = PendingIngestion(
            id="ing-current",
            user_id=user_id,
            hook_id="hook-current",
            received_at=now,
            raw_payload={},
            raw_msg="SMS: Paid 150.50",
            ai_parsed=AiParsedData(
                amount=150.50,
                reference_number=None,
                date=now
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="sms"
        )

        # Candidate 20 minutes earlier (outside 5-minute window)
        existing_candidate = PendingIngestion(
            id="ing-old",
            user_id=user_id,
            hook_id="hook-old",
            received_at=now - timedelta(minutes=20),
            raw_payload={},
            raw_msg="Push: Payment of 150.50",
            ai_parsed=AiParsedData(
                amount=150.50,
                reference_number=None,
                date=now - timedelta(minutes=20)
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="app"
        )

        self.mock_repo.find_candidates_for_relation_async.return_value = [existing_candidate]
        self.mock_finance_api.search_confirmed_ledger_entries_async.return_value = []

        await self.service.detect_and_link_relations_async(current_ing)

        self.assertEqual(len(current_ing.related_ingestion_ids), 0)
        self.assertEqual(len(current_ing.possible_related_ingestion_ids), 0)
        self.mock_repo.update_async.assert_not_called()

    async def test_confirmed_match_detected(self):
        now = datetime.now(timezone.utc)
        user_id = "user-123"

        current_ing = PendingIngestion(
            id="ing-current",
            user_id=user_id,
            hook_id="hook-current",
            received_at=now,
            raw_payload={},
            raw_msg="Email: Confirmed Ref REF-CONFIRMED",
            ai_parsed=AiParsedData(
                amount=1000.0,
                reference_number="REF-CONFIRMED",
                date=now
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="email"
        )

        self.mock_repo.find_candidates_for_relation_async.return_value = []
        self.mock_finance_api.search_confirmed_ledger_entries_async.return_value = [
            {"transaction_id": "tx-confirmed-1", "match_type": "reference_number"}
        ]

        await self.service.detect_and_link_relations_async(current_ing)

        self.assertTrue(current_ing.has_possible_confirmed_match)
        self.assertIn("tx-confirmed-1", current_ing.related_transaction_ids)

    async def test_build_related_context_pre_classify(self):
        now = datetime.now(timezone.utc)
        user_id = "user-123"

        cand = PendingIngestion(
            id="cand-1",
            user_id=user_id,
            hook_id="hook-cand",
            received_at=now - timedelta(minutes=2),
            raw_payload={},
            raw_msg="SMS: Paid 250",
            ai_parsed=AiParsedData(
                amount=250.0,
                reference_number="REF-ABC",
                credit_account_id="acc-card-1",
                vendor=None,
                date=now - timedelta(minutes=2)
            ),
            month_key=now.strftime("%Y-%m"),
            partition_key=user_id,
            notification_type="sms"
        )

        self.mock_repo.find_candidates_for_relation_async.return_value = [cand]
        self.mock_finance_api.search_confirmed_ledger_entries_async.return_value = [
            {"transaction_id": "tx-100", "match_type": "reference_number"}
        ]

        context_str = await self.service._build_related_context_async(
            user_id=user_id,
            reference_number="REF-ABC",
            amount=250.0,
            effective_time=now
        )

        self.assertIn("[DEFINITE MATCH (Same Ref)]", context_str)
        self.assertIn("REF-ABC", context_str)
        self.assertIn("[CONFIRMED TRANSACTION MATCH]", context_str)
        self.assertIn("tx-100", context_str)


if __name__ == "__main__":
    unittest.main()
