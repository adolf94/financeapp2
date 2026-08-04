from azure.cosmos import PartitionKey

def up(db):
    """Create the PromptDebugLogs container partitioned by /UserId with a 30-day default TTL."""
    print("Ensuring container 'PromptDebugLogs' exists (partition key: /UserId, default TTL: 30 days)...")
    db.create_container_if_not_exists(
        id="PromptDebugLogs",
        partition_key=PartitionKey(path="/UserId"),
        default_ttl=30 * 24 * 60 * 60 # 30 days in seconds
    )
