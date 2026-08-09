import jwt
import time
import os
import logging
import aiohttp

def parse_connection_string(conn_str: str):
    dict_conn = {}
    for part in conn_str.split(';'):
        if '=' in part:
            k, v = part.split('=', 1)
            dict_conn[k.strip()] = v.strip()
    return dict_conn.get("Endpoint"), dict_conn.get("AccessKey")

def generate_jwt_token(audience: str, access_key: str):
    payload = {
        "aud": audience,
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600
    }
    return jwt.encode(payload, access_key, algorithm="HS256")

async def publish_signalr_message(hub_name: str, target: str, arguments: list, user_id: str = None, group_name: str = None):
    conn_str = os.environ.get("AzureSignalRConnectionString")
    if not conn_str or "mock" in conn_str.lower():
        # Only skip if explicitly using a mock placeholder (not local emulator)
        logging.info(f"[SignalR Mock] Broadcast to target '{target}' with arguments: {arguments} (user_id: {user_id}, group_name: {group_name})")
        return
        
    try:
        endpoint, access_key = parse_connection_string(conn_str)
        if not endpoint or not access_key:
            logging.error("Invalid AzureSignalRConnectionString format.")
            return

        if endpoint.endswith('/'):
            endpoint = endpoint[:-1]
            
        if group_name:
            url = f"{endpoint}/api/v1/hubs/{hub_name}/groups/{group_name}"
            post_url = url
        elif user_id:
            url = f"{endpoint}/api/v1/hubs/{hub_name}/users/{user_id}"
            post_url = url
        else:
            url = f"{endpoint}/api/v1/hubs/{hub_name}"
            post_url = url
            
        token = generate_jwt_token(url, access_key)
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "target": target,
            "arguments": arguments
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(post_url, json=payload, headers=headers) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logging.error(f"Failed to publish to SignalR REST API. Status: {resp.status}, Body: {body}")
    except Exception as e:
        logging.error(f"Error publishing to SignalR: {e}")

async def add_user_to_group(hub_name: str, user_id: str, group_name: str):
    conn_str = os.environ.get("AzureSignalRConnectionString")
    if not conn_str or "mock" in conn_str.lower():
        return
    try:
        endpoint, access_key = parse_connection_string(conn_str)
        if not endpoint or not access_key:
            return
        if endpoint.endswith('/'):
            endpoint = endpoint[:-1]
            
        url = f"{endpoint}/api/v1/hubs/{hub_name}/users/{user_id}/groups/{group_name}"
        token = generate_jwt_token(url, access_key)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.put(url, headers=headers, json={}) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logging.error(f"Failed to add user {user_id} to group {group_name}. Status: {resp.status}, Body: {body}")
    except Exception as e:
        logging.error(f"Error adding user to group: {e}")

async def remove_user_from_group(hub_name: str, user_id: str, group_name: str):
    conn_str = os.environ.get("AzureSignalRConnectionString")
    if not conn_str or "mock" in conn_str.lower():
        return
    try:
        endpoint, access_key = parse_connection_string(conn_str)
        if not endpoint or not access_key:
            return
        if endpoint.endswith('/'):
            endpoint = endpoint[:-1]
            
        url = f"{endpoint}/api/v1/hubs/{hub_name}/users/{user_id}/groups/{group_name}"
        token = generate_jwt_token(url, access_key)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.delete(url, headers=headers) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logging.error(f"Failed to remove user {user_id} from group {group_name}. Status: {resp.status}, Body: {body}")
    except Exception as e:
        logging.error(f"Error removing user from group: {e}")

async def add_connection_to_group(hub_name: str, connection_id: str, group_name: str):
    conn_str = os.environ.get("AzureSignalRConnectionString")
    if not conn_str or "mock" in conn_str.lower():
        return
    try:
        endpoint, access_key = parse_connection_string(conn_str)
        if not endpoint or not access_key:
            return
        if endpoint.endswith('/'):
            endpoint = endpoint[:-1]
            
        url = f"{endpoint}/api/v1/hubs/{hub_name}/connections/{connection_id}/groups/{group_name}"
        token = generate_jwt_token(url, access_key)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.put(url, headers=headers, json={}) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logging.error(f"Failed to add connection {connection_id} to group {group_name}. Status: {resp.status}, Body: {body}")
    except Exception as e:
        logging.error(f"Error adding connection to group: {e}")

async def remove_connection_from_group(hub_name: str, connection_id: str, group_name: str):
    conn_str = os.environ.get("AzureSignalRConnectionString")
    if not conn_str or "mock" in conn_str.lower():
        return
    try:
        endpoint, access_key = parse_connection_string(conn_str)
        if not endpoint or not access_key:
            return
        if endpoint.endswith('/'):
            endpoint = endpoint[:-1]
            
        url = f"{endpoint}/api/v1/hubs/{hub_name}/connections/{connection_id}/groups/{group_name}"
        token = generate_jwt_token(url, access_key)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.delete(url, headers=headers) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logging.error(f"Failed to remove connection {connection_id} from group {group_name}. Status: {resp.status}, Body: {body}")
    except Exception as e:
        logging.error(f"Error removing connection from group: {e}")
