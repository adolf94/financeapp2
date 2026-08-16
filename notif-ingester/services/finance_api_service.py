import os
from datetime import datetime, timezone
from typing import Optional
from azure.cosmos.aio import CosmosClient
from models.pending_ingestion import PendingIngestion
from uuid_extensions import uuid7

from repositories.cosmos_client import get_cosmos_client

class FinanceApiService:
    def __init__(self):
        self.client = get_cosmos_client()
        self.db_name = os.environ.get("COSMOS_DB", "FinanceDb")

    async def get_accounts_async(self, user_id: str) -> list[dict]:
        if not self.client:
            return []
            
        db = self.client.get_database_client(self.db_name)
        
        # Fetch account groups to map Group ID to Group Name
        group_map = {}
        try:
            groups_container = db.get_container_client("AccountGroups")
            groups_query = "SELECT * FROM c"
            groups_items = groups_container.query_items(
                query=groups_query,
                partition_key=user_id
            )
            async for item in groups_items:
                g_id = item.get("id")
                g_name = item.get("Name", item.get("name"))
                if g_id and g_name:
                    group_map[g_id] = g_name
        except Exception as e:
            # Fallback gracefully if AccountGroups container fails
            import logging
            logging.warning(f"Failed to fetch account groups: {e}")

        # Fetch accounts
        container = db.get_container_client("Accounts")
        
        query = "SELECT * FROM c"
        items = container.query_items(
            query=query,
            partition_key=user_id
        )
        accounts = []
        async for item in items:
            g_id = item.get("AccountGroupId", item.get("accountGroupId"))
            accounts.append({
                "id": item.get("id"),
                "name": item.get("Name", item.get("name")),
                "description": item.get("Description", item.get("description")),
                "tags": item.get("Tags", []),
                "accountType": item.get("AccountType", item.get("accountType")),
                "accountGroupId": g_id,
                "accountGroupName": group_map.get(g_id) if g_id else None
            })
        return accounts

    async def get_specific_accounts_async(self, user_id: str, account_ids: list[str]) -> list[dict]:
        if not self.client or not account_ids:
            return []
            
        valid_ids = [aid for aid in account_ids if aid]
        if not valid_ids:
            return []
            
        db = self.client.get_database_client(self.db_name)
        
        # 1. Fetch only the requested accounts
        container = db.get_container_client("Accounts")
        parameters = [{"name": f"@id{i}", "value": val} for i, val in enumerate(valid_ids)]
        param_names = ", ".join(p["name"] for p in parameters)
        
        query = f"SELECT * FROM c WHERE c.id IN ({param_names})"
        items = container.query_items(
            query=query,
            parameters=parameters,
            partition_key=user_id
        )
        
        accounts = []
        group_ids = set()
        async for item in items:
            g_id = item.get("AccountGroupId", item.get("accountGroupId"))
            if g_id:
                group_ids.add(g_id)
            accounts.append({
                "id": item.get("id"),
                "name": item.get("Name", item.get("name")),
                "accountGroupId": g_id
            })
            
        # 2. Fetch only the required account groups
        group_map = {}
        if group_ids:
            try:
                groups_container = db.get_container_client("AccountGroups")
                g_params = [{"name": f"@gid{i}", "value": val} for i, val in enumerate(group_ids)]
                g_param_names = ", ".join(p["name"] for p in g_params)
                
                g_query = f"SELECT c.id, c.Name, c.name FROM c WHERE c.id IN ({g_param_names})"
                g_items = groups_container.query_items(
                    query=g_query,
                    parameters=g_params,
                    partition_key=user_id
                )
                async for item in g_items:
                    g_id = item.get("id")
                    g_name = item.get("Name", item.get("name"))
                    if g_id and g_name:
                        group_map[g_id] = g_name
            except Exception as e:
                import logging
                logging.warning(f"Failed to fetch specific account groups: {e}")
                
        # 3. Assemble and return
        for acc in accounts:
            g_id = acc["accountGroupId"]
            acc["accountGroupName"] = group_map.get(g_id) if g_id else None
            
        return accounts

    async def get_vendors_async(self, user_id: str) -> list[dict]:
        if not self.client:
            return []
            
        db = self.client.get_database_client(self.db_name)
        try:
            vendor_container = db.get_container_client("Vendors")
            query = "SELECT * FROM c"
            items = vendor_container.query_items(
                query=query,
                partition_key=user_id
            )
            vendors = []
            async for item in items:
                vendors.append({
                    "id": item.get("id"),
                    "name": item.get("Name", item.get("name")),
                    "type": item.get("Type", item.get("type", "Business")),
                    "tags": item.get("Tags", item.get("tags", [])),
                    "last_used": item.get("LastUsed", item.get("last_used"))
                })
            # Sort by name
            vendors.sort(key=lambda x: (x.get("name") or "").lower())
            return vendors
        except Exception as e:
            import logging
            logging.warning(f"Error fetching vendors: {e}")
            return []

    async def search_vendors_by_lookups_async(self, user_id: str, lookups: list[str]) -> tuple[str | None, list[str]]:
        if not self.client or not lookups:
            return None, []
            
        db = self.client.get_database_client(self.db_name)
        try:
            lookup_container = db.get_container_client("VendorLookups")
            lookup_values = [loc.lower().strip() for loc in lookups if loc and isinstance(loc, str) and loc.strip()]
            if not lookup_values:
                return None, []
                
            parameters = [{"name": f"@p{i}", "value": val} for i, val in enumerate(lookup_values)]
            param_names = ", ".join(p["name"] for p in parameters)
            
            query = f"SELECT c.VendorId, c.Hits, c.LookupValue FROM c WHERE c.LookupValue IN ({param_names})"
            items = lookup_container.query_items(
                query=query,
                parameters=parameters,
                partition_key=user_id
            )
            
            vendor_hits = {}
            total_hits = 0
            vendor_lookups = {}
            
            async for item in items:
                v_id = item.get("VendorId")
                hits = item.get("Hits", 1)
                l_val = item.get("LookupValue")
                vendor_hits[v_id] = vendor_hits.get(v_id, 0) + hits
                total_hits += hits
                if v_id not in vendor_lookups:
                    vendor_lookups[v_id] = []
                vendor_lookups[v_id].append(l_val)
                
            vendor_id = None
            matched_lookups = []
            if vendor_hits and total_hits > 0:
                # Find top vendor
                top_vendor_id, top_hits = max(vendor_hits.items(), key=lambda x: x[1])
                if top_hits / total_hits > 0.51:
                    vendor_id = top_vendor_id
                    matched_lookups = vendor_lookups.get(vendor_id, [])
                
            if vendor_id:
                vendor_container = db.get_container_client("Vendors")
                try:
                    vendor = await vendor_container.read_item(item=vendor_id, partition_key=user_id)
                    return vendor.get("Name"), matched_lookups
                except Exception:
                    pass
            
            # Fallback: check exact name match directly
            vendor_container = db.get_container_client("Vendors")
            query_name = f"SELECT c.Name FROM c WHERE LOWER(c.Name) IN ({param_names})"
            items_name = vendor_container.query_items(
                query=query_name,
                parameters=parameters,
                partition_key=user_id,
                max_item_count=1
            )
            async for item in items_name:
                matched_name = item.get("Name")
                matched_input = [l for l in lookups if l.lower().strip() == matched_name.lower().strip()]
                return matched_name, matched_input if matched_input else [matched_name]
                
        except Exception as e:
            import logging
            logging.warning(f"Error searching vendors by lookups: {e}")
        return None, []

    async def search_all_vendor_matches_by_lookups_async(self, user_id: str, lookups: list[str]) -> list[dict]:
        """
        Search for ALL vendor matches by lookup values.
        Returns list of dictionaries with vendor info and matching lookup strings.
        
        Format: [
            {
                "vendor_id": str,
                "vendor_name": str,
                "matched_lookups": list[str],  # Which lookup values matched
                "total_hits": int,             # Sum of hits for matched lookups
                "vendor_type": str,            # Vendor type if available
                "vendor_tags": list[str]       # Vendor tags for categorization
            },
            ...
        ]
        """
        if not self.client or not lookups:
            return []
            
        db = self.client.get_database_client(self.db_name)
        try:
            lookup_container = db.get_container_client("VendorLookups")
            vendor_container = db.get_container_client("Vendors")
            
            # Normalize lookup values
            lookup_values = [loc.lower().strip() for loc in lookups if loc and isinstance(loc, str) and loc.strip()]
            if not lookup_values:
                return []
                
            # Query all lookup matches
            parameters = [{"name": f"@p{i}", "value": val} for i, val in enumerate(lookup_values)]
            param_names = ", ".join(p["name"] for p in parameters)
            
            query = f"SELECT c.VendorId, c.LookupValue, c.Hits FROM c WHERE c.LookupValue IN ({param_names})"
            lookup_items = lookup_container.query_items(
                query=query,
                parameters=parameters,
                partition_key=user_id
            )
            
            # Group by vendor ID
            vendor_matches = {}
            
            async for item in lookup_items:
                v_id = item.get("VendorId")
                lookup_value = item.get("LookupValue")
                hits = item.get("Hits", 1)
                
                if v_id not in vendor_matches:
                    vendor_matches[v_id] = {
                        "vendor_id": v_id,
                        "matched_lookups": [],
                        "total_hits": 0
                    }
                
                vendor_matches[v_id]["matched_lookups"].append(lookup_value)
                vendor_matches[v_id]["total_hits"] += hits
            
            # Fetch vendor details for matched vendors
            matches_list = []
            for v_id, match_info in vendor_matches.items():
                try:
                    vendor = await vendor_container.read_item(item=v_id, partition_key=user_id)
                    match_info["vendor_name"] = vendor.get("Name", "")
                    match_info["vendor_type"] = vendor.get("Type", "Business")
                    match_info["vendor_tags"] = vendor.get("Tags", []) or vendor.get("tags", [])
                    matches_list.append(match_info)
                except Exception:
                    # Skip vendors we can't fetch details for
                    continue
            
            # Sort by total hits (most frequent matches first)
            matches_list.sort(key=lambda x: x["total_hits"], reverse=True)
            
            return matches_list
            
        except Exception as e:
            import logging
            logging.warning(f"Error searching all vendor matches by lookups: {e}")
            return []

    async def ensure_vendor_and_lookups_async(self, user_id: str, vendor_name: str, lookups: list[str], vendor_type: str = None, transaction_date: Optional[datetime] = None) -> str | None:
        if not self.client or not vendor_name:
            return None
            
        db = self.client.get_database_client(self.db_name)
        vendor_container = db.get_container_client("Vendors")
        
        # Check if vendor exists by exact name match
        query = "SELECT * FROM c WHERE LOWER(c.Name) = @name"
        parameters = [{"name": "@name", "value": vendor_name.lower().strip()}]
        items = vendor_container.query_items(
            query=query,
            parameters=parameters,
            partition_key=user_id,
            max_item_count=1
        )
        
        vendor_id = None
        existing_doc = None
        async for item in items:
            vendor_id = item.get("id")
            existing_doc = item
            break
            
        target_dt = transaction_date or datetime.now(timezone.utc)
        if target_dt.tzinfo is None:
            target_dt = target_dt.replace(tzinfo=timezone.utc)
        target_iso = target_dt.isoformat()

        if not vendor_id:
            vendor_id = str(uuid7())
            doc = {
                "id": vendor_id,
                "UserId": user_id,
                "Name": vendor_name,
                "Tags": [],
                "LastUsed": target_iso
            }
            if vendor_type:
                doc["Type"] = vendor_type
            await vendor_container.create_item(doc)
        elif existing_doc:
            existing_last_used_str = existing_doc.get("LastUsed")
            should_update = False
            if not existing_last_used_str:
                should_update = True
            else:
                try:
                    existing_dt = datetime.fromisoformat(existing_last_used_str.replace("Z", "+00:00"))
                    if target_dt > existing_dt:
                        should_update = True
                except Exception:
                    should_update = True

            if should_update:
                existing_doc["LastUsed"] = target_iso
                await vendor_container.upsert_item(existing_doc)
            
        if lookups:
            lookup_container = db.get_container_client("VendorLookups")
            normalized_lookups = list(set([loc.lower().strip() for loc in lookups if loc and isinstance(loc, str) and loc.strip()]))
            
            if normalized_lookups:
                # Fetch existing lookups for this vendor that match our new lookups
                parameters = [{"name": f"@p{i}", "value": val} for i, val in enumerate(normalized_lookups)]
                parameters.append({"name": "@vendorId", "value": vendor_id})
                param_names = ", ".join([f"@p{i}" for i in range(len(normalized_lookups))])
                
                query = f"SELECT * FROM c WHERE c.VendorId = @vendorId AND c.LookupValue IN ({param_names})"
                
                existing_items = lookup_container.query_items(
                    query=query,
                    parameters=parameters,
                    partition_key=user_id
                )
                
                existing_lookups = set()
                async for item in existing_items:
                    existing_lookups.add(item.get("LookupValue"))
                    # Increment hits
                    item["Hits"] = item.get("Hits", 1) + 1
                    await lookup_container.upsert_item(item)
                    
                new_lookups = [l for l in normalized_lookups if l not in existing_lookups]
                for new_l in new_lookups:
                    lookup_doc = {
                        "id": str(uuid7()),
                        "UserId": user_id,
                        "VendorId": vendor_id,
                        "LookupValue": new_l,
                        "Hits": 1
                    }
                    await lookup_container.create_item(lookup_doc)
                    
        return vendor_name

    async def create_transaction_async(self, ingestion: PendingIngestion) -> dict:
        if not self.client:
            raise Exception("No cosmos client available")
            
        db = self.client.get_database_client(self.db_name)
        tx_container = db.get_container_client("Transactions")
        accounts_container = db.get_container_client("Accounts")
        
        parsed = ingestion.ai_parsed
        if not parsed.amount or not parsed.debit_account_id or not parsed.credit_account_id:
            raise Exception("Amount, DebitAccountId, and CreditAccountId are required")
            
        tx_type = parsed.transaction_type or "Expense"
        if tx_type not in ["Income", "Expense", "Transfer", "Journal"]:
            tx_type = "Expense"
            
        from datetime import datetime, timezone
        
        tx_id = str(uuid7())
        
        # 1. Create the main Transaction document (EF Core format)
        tx_date = parsed.date or ingestion.received_at or datetime.now(timezone.utc)
        if tx_date.tzinfo is None:
            tx_date = tx_date.replace(tzinfo=timezone.utc)
        else:
            tx_date = tx_date.astimezone(timezone.utc)
        tx_date_iso = tx_date.strftime("%Y-%m-%dT%H:%M:%SZ")

        vendor_lookups = []
        if parsed.vendor:
            if parsed.vendor.lookups:
                vendor_lookups.extend(parsed.vendor.lookups)
            if parsed.vendor.new_lookups:
                vendor_lookups.extend(parsed.vendor.new_lookups)
        vendor_lookups = list(set([l for l in vendor_lookups if l]))

        tx_doc = {
            "id": f"Transaction|{tx_id}",
            "Id": tx_id,
            "UserId": ingestion.user_id,
            "Date": tx_date_iso,
            "Vendor": parsed.vendor.name if parsed.vendor else None,
            "Type": tx_type,
            "Note": parsed.notes or "",
            "IsAutoConfirmed": parsed.is_auto_confirmed if parsed.is_auto_confirmed is not None else False,
            "IngestionId": ingestion.id,
            "MatchedVendorLookups": vendor_lookups,
            "NewVendorLookups": [],
            "$type": "Transaction"
        }
        
        await tx_container.create_item(tx_doc)
        
        # 2. Create the LedgerEntry documents (EF Core format)
        credit_id = str(uuid7())
        credit_entry = {
            "id": f"LedgerEntry|{credit_id}",
            "Id": credit_id,
            "UserId": ingestion.user_id,
            "TransactionId": tx_id,
            "AccountId": parsed.credit_account_id,
            "Amount": -parsed.amount,
            "$type": "LedgerEntry"
        }
        await tx_container.create_item(credit_entry)

        multi_orders = parsed.multi_order_items or []
        if multi_orders and len(multi_orders) > 1:
            # N Debit entries for multi-order Shopee checkout
            for order in multi_orders:
                order_amt = float(order.get("amount", 0))
                order_acc = order.get("debit_account_id") or parsed.debit_account_id
                order_ref = order.get("reference_number") or parsed.reference_number
                order_note = order.get("notes") or (order.get("vendor", {}).get("name") if isinstance(order.get("vendor"), dict) else order.get("vendor")) or parsed.notes
                d_id = str(uuid7())
                d_entry = {
                    "id": f"LedgerEntry|{d_id}",
                    "Id": d_id,
                    "UserId": ingestion.user_id,
                    "TransactionId": tx_id,
                    "AccountId": order_acc,
                    "Amount": order_amt,
                    "Note": order_note or "",
                    "ReferenceNumber": order_ref,
                    "$type": "LedgerEntry"
                }
                await tx_container.create_item(d_entry)

                # Update individual debit account balance
                try:
                    debit_account = await accounts_container.read_item(order_acc, partition_key=ingestion.user_id)
                    debit_account["CurrentBalance"] = debit_account.get("CurrentBalance", 0) + order_amt
                    await accounts_container.replace_item(order_acc, debit_account)
                except Exception as e:
                    import logging
                    logging.error(f"Failed to update debit account balance for {order_acc}: {e}")
        else:
            debit_id = str(uuid7())
            debit_entry = {
                "id": f"LedgerEntry|{debit_id}",
                "Id": debit_id,
                "UserId": ingestion.user_id,
                "TransactionId": tx_id,
                "AccountId": parsed.debit_account_id,
                "Amount": parsed.amount,
                "Note": parsed.notes or "",
                "ReferenceNumber": parsed.reference_number,
                "$type": "LedgerEntry"
            }
            await tx_container.create_item(debit_entry)

            # Update single debit account balance
            try:
                debit_account = await accounts_container.read_item(parsed.debit_account_id, partition_key=ingestion.user_id)
                debit_account["CurrentBalance"] = debit_account.get("CurrentBalance", 0) + parsed.amount
                await accounts_container.replace_item(parsed.debit_account_id, debit_account)
            except Exception as e:
                import logging
                logging.error(f"Failed to update single debit account balance: {e}")

        # 3. Update Credit Account balance
        try:
            credit_account = await accounts_container.read_item(parsed.credit_account_id, partition_key=ingestion.user_id)
            credit_account["CurrentBalance"] = credit_account.get("CurrentBalance", 0) - parsed.amount
            await accounts_container.replace_item(parsed.credit_account_id, credit_account)
        except Exception as e:
            import logging
            logging.error(f"Failed to update credit account balance: {e}")
            
        # 4. Ensure Vendor and Lookups
        lookups = []
        if parsed.recipient_account_name: lookups.append(parsed.recipient_account_name)
        if parsed.recipient_account_number: lookups.append(parsed.recipient_account_number)
        if parsed.sender_account_name: lookups.append(parsed.sender_account_name)
        if parsed.sender_account_number: lookups.append(parsed.sender_account_number)
        if parsed.vendor and parsed.vendor.name: lookups.append(parsed.vendor.name)
        if parsed.application: lookups.append(parsed.application)
        
        if parsed.vendor and parsed.vendor.name:
            await self.ensure_vendor_and_lookups_async(
                ingestion.user_id,
                parsed.vendor.name,
                lookups,
                parsed.vendor.type,
                transaction_date=parsed.date
            )
            
        return tx_doc

    async def get_runbook_content_async(self, user_id: str, runbook_id: str = "runbook") -> str:
        """Fetch runbook content by id. Default is 'runbook' (app). Use 'runbook-sms' for SMS."""
        if not self.client:
            return ""
        try:
            db = self.client.get_database_client(self.db_name)
            container = db.get_container_client("Settings")
            item = await container.read_item(item=runbook_id, partition_key=user_id)
            return item.get("content", "")
        except Exception:
            return ""

    async def save_runbook_content_async(self, user_id: str, content: str, runbook_id: str = "runbook") -> None:
        """Persist runbook content by id. Default is 'runbook' (app). Use 'runbook-sms' for SMS."""
        if not self.client:
            return
        db = self.client.get_database_client(self.db_name)
        container = db.get_container_client("Settings")
        doc = {
            "id": runbook_id,
            "UserId": user_id,
            "content": content
        }
        await container.upsert_item(doc)

    async def get_sms_runbook_content_async(self, user_id: str) -> str:
        """Fetch the SMS-specific runbook. Returns empty string if not found."""
        return await self.get_runbook_content_async(user_id, runbook_id="runbook-sms")

    async def save_sms_runbook_content_async(self, user_id: str, content: str) -> None:
        """Persist the SMS-specific runbook."""
        await self.save_runbook_content_async(user_id, content, runbook_id="runbook-sms")

    async def update_account_descriptions_async(self, user_id: str, updates: list[dict]) -> None:
        if not self.client or not updates:
            return
            
        db = self.client.get_database_client(self.db_name)
        container = db.get_container_client("Accounts")
        
        for update in updates:
            account_id = update.get("account_id")
            new_description = update.get("new_description")
            if not account_id:
                continue
                
            try:
                item = await container.read_item(item=account_id, partition_key=user_id)
                if new_description is not None:
                    item["Description"] = new_description
                    item["description"] = new_description # Ensure both cases just in case
                if "new_tags" in update:
                    item["Tags"] = update.get("new_tags", [])
                await container.upsert_item(item)
            except Exception as e:
                import logging
                logging.error(f"Failed to update account {account_id} description: {e}")

    async def update_vendor_tags_async(self, user_id: str, updates: list[dict]) -> None:
        if not self.client or not updates:
            return
            
        db = self.client.get_database_client(self.db_name)
        container = db.get_container_client("Vendors")
        
        for update in updates:
            vendor_id = update.get("vendor_id")
            new_tags = update.get("new_tags")
            if not vendor_id or new_tags is None:
                continue
                
            try:
                item = await container.read_item(item=vendor_id, partition_key=user_id)
                item["Tags"] = new_tags
                item["tags"] = new_tags
                await container.upsert_item(item)
            except Exception as e:
                import logging
                logging.error(f"Failed to update vendor {vendor_id} tags: {e}")

    async def get_runbook_session_async(self, user_id: str) -> dict | None:
        """Fetch an active runbook review session from the Settings container."""
        if not self.client:
            return None
        try:
            db = self.client.get_database_client(self.db_name)
            container = db.get_container_client("Settings")
            item = await container.read_item(item="runbook-review-session", partition_key=user_id)
            return item
        except Exception:
            return None

    async def save_runbook_session_async(self, user_id: str, session: dict) -> None:
        """Upsert a runbook review session into the Settings container."""
        if not self.client:
            return
        db = self.client.get_database_client(self.db_name)
        container = db.get_container_client("Settings")
        session["id"] = "runbook-review-session"
        session["UserId"] = user_id
        await container.upsert_item(session)

    async def delete_runbook_session_async(self, user_id: str) -> None:
        """Delete the active runbook review session from the Settings container."""
        if not self.client:
            return
        try:
            db = self.client.get_database_client(self.db_name)
            container = db.get_container_client("Settings")
            await container.delete_item(item="runbook-review-session", partition_key=user_id)
        except Exception:
            pass  # Already gone — that's fine

    async def search_confirmed_ledger_entries_async(
        self,
        user_id: str,
        reference_number: str = None,
        amount: float = None,
        around_time = None,
        window_minutes: int = 5
    ) -> list[dict]:
        """
        Search confirmed transactions and ledger entries by reference_number (past 30 days)
        or amount + time window (+/- window_minutes around around_time).
        Returns list of matching transaction records with their TransactionId.
        """
        if not self.client:
            return []
            
        from datetime import datetime, timezone, timedelta
        
        db = self.client.get_database_client(self.db_name)
        tx_container = db.get_container_client("Transactions")
        
        matches = []
        try:
            # Case 1: Match by reference_number in past 30 days
            if reference_number and str(reference_number).strip():
                ref_clean = str(reference_number).strip()
                cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
                
                # Query transactions or ledger entries by ReferenceNumber
                # Direct check on Transaction docs
                tx_query = (
                    "SELECT c.id, c.Id, c.Date, c.ReferenceNumber, c.Vendor, c.Note FROM c "
                    "WHERE c.UserId = @user_id AND c.ReferenceNumber = @ref AND c.Date >= @cutoff"
                )
                params = [
                    {"name": "@user_id", "value": user_id},
                    {"name": "@ref", "value": ref_clean},
                    {"name": "@cutoff", "value": cutoff}
                ]
                async for item in tx_container.query_items(query=tx_query, parameters=params):
                    tx_id = item.get("Id") or (item.get("id", "").replace("Transaction|", "") if item.get("id") else "")
                    if tx_id:
                        matches.append({
                            "transaction_id": tx_id,
                            "date": item.get("Date"),
                            "reference_number": item.get("ReferenceNumber"),
                            "match_type": "reference_number"
                        })
                
                # Also check LedgerEntry docs if not found or in addition
                le_query = (
                    "SELECT c.id, c.Id, c.TransactionId, c.ReferenceNumber, c.Amount FROM c "
                    "WHERE c.UserId = @user_id AND c.ReferenceNumber = @ref"
                )
                le_params = [
                    {"name": "@user_id", "value": user_id},
                    {"name": "@ref", "value": ref_clean}
                ]
                async for item in tx_container.query_items(query=le_query, parameters=le_params):
                    tx_id = item.get("TransactionId")
                    if tx_id and not any(m["transaction_id"] == tx_id for m in matches):
                        matches.append({
                            "transaction_id": tx_id,
                            "reference_number": item.get("ReferenceNumber"),
                            "match_type": "reference_number"
                        })
            
            # Case 2: Match by amount + effective time window (5 mins)
            if amount is not None and around_time is not None:
                if isinstance(around_time, str):
                    try:
                        around_dt = datetime.fromisoformat(around_time.replace("Z", "+00:00"))
                    except Exception:
                        around_dt = datetime.now(timezone.utc)
                else:
                    around_dt = around_time
                    
                if around_dt.tzinfo is None:
                    around_dt = around_dt.replace(tzinfo=timezone.utc)
                    
                min_dt = (around_dt - timedelta(minutes=window_minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
                max_dt = (around_dt + timedelta(minutes=window_minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
                
                tx_time_query = (
                    "SELECT c.id, c.Id, c.Date FROM c "
                    "WHERE c.UserId = @user_id AND c.Date >= @min_date AND c.Date <= @max_date"
                )
                time_params = [
                    {"name": "@user_id", "value": user_id},
                    {"name": "@min_date", "value": min_dt},
                    {"name": "@max_date", "value": max_dt}
                ]
                
                candidate_tx_ids = []
                async for item in tx_container.query_items(query=tx_time_query, parameters=time_params):
                    tx_id = item.get("Id") or (item.get("id", "").replace("Transaction|", "") if item.get("id") else "")
                    if tx_id:
                        candidate_tx_ids.append(tx_id)
                        
                if candidate_tx_ids:
                    # Query ledger entries for these transactions
                    id_params = [{"name": f"@id{i}", "value": tid} for i, tid in enumerate(candidate_tx_ids)]
                    id_names = ", ".join(p["name"] for p in id_params)
                    id_params.append({"name": "@user_id", "value": user_id})
                    
                    le_query = f"SELECT c.TransactionId, c.Amount FROM c WHERE c.UserId = @user_id AND c.TransactionId IN ({id_names})"
                    target_abs_amount = round(abs(float(amount)), 2)
                    
                    async for item in tx_container.query_items(query=le_query, parameters=id_params):
                        entry_amount = item.get("Amount")
                        if entry_amount is not None and round(abs(float(entry_amount)), 2) == target_abs_amount:
                            tx_id = item.get("TransactionId")
                            if tx_id and not any(m["transaction_id"] == tx_id for m in matches):
                                matches.append({
                                    "transaction_id": tx_id,
                                    "amount": entry_amount,
                                    "match_type": "time_and_amount"
                                })
        except Exception as e:
            import logging
            logging.error(f"Error searching confirmed ledger entries: {e}")
            
        return matches

