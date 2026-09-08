import os
import json
from azure.cosmos import CosmosClient
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import logging
logging.getLogger('azure.core.pipeline.policies.http_logging_policy').setLevel(logging.WARNING)

def main():
    with open('local.settings.json') as f:
        settings = json.load(f)
    
    conn_str = settings['Values']['CosmosConnectionString']
    db_name = settings['Values']['COSMOS_DB']
    
    client = CosmosClient.from_connection_string(conn_str, connection_verify=False)
    db = client.get_database_client(db_name)
    container = db.get_container_client('VendorLookups')
    
    bad_lookups = [
        "master-card", "mastercard", "visa", "gcash", "paymaya", "maya", 
        "credit card", "debit card", "credit", "debit", "bdo", "bpi", "unionbank", "metrobank",
        "instapay", "pesonet", "bank"
    ]
    
    params = [{"name": f"@p{i}", "value": v} for i, v in enumerate(bad_lookups)]
    param_str = ", ".join([p["name"] for p in params])
    
    query = f"SELECT * FROM c WHERE LOWER(c.LookupValue) IN ({param_str})"
    
    items = list(container.query_items(query=query, parameters=params))
    
    deleted = 0
    for item in items:
        print(f"Deleting {item['LookupValue']} for user {item['UserId']}")
        container.delete_item(item=item['id'], partition_key=item['UserId'])
        deleted += 1
        
    print(f"Deleted {deleted} bad lookups")

if __name__ == '__main__':
    main()
