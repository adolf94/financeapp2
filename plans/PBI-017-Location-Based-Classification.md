---
github_issue: ~
status: draft
---
# PBI-017: Location-Based Transaction Classification Context

## Problem Statement

The phone hook payload already includes the device's latitude and longitude at the time the notification is received. Currently, this data is ignored. Location context is useful for improving transaction classification accuracy:

- A notification received **at home** may indicate an online purchase or a bill payment — vendor should not be a physical store.
- A notification received **at the office** may indicate a nearby restaurant or canteen expense.
- A notification received **near a known merchant** (e.g., grocery store) can help auto-confirm vendor suggestions.

The goal is to let the user define **named locations** (e.g., Home, Office, Gym) with a lat/lng center and a radius, and use this context to enrich AI classification prompts.

---

## Current State

- `PhoneHookMessage.raw_payload` (dict) contains the full phone hook JSON including lat/lng, but the fields are not parsed or surfaced.
- `PhoneHookMessage` model has no dedicated location fields.
- AI classification prompts have no awareness of physical location.

---

## Technical Requirements

### 1. Parse Location from Hook Payload

- Add `latitude: Optional[float]` and `longitude: Optional[float]` to `PhoneHookMessage`.
- Populated from `raw_payload.get("latitude")` / `raw_payload.get("longitude")` in `HookService.save_hook_async()`.
- If lat/lng is absent (e.g., email hooks, permission denied on device), fields remain `None` — no location context injected. Silent fallback.

### 2. Named Locations (User-defined)

New CosmosDB container: **`UserLocations`**, partitioned by `/UserId`.

```python
class UserLocation(BaseModel):
    id: str                     # uuid
    user_id: str
    name: str                   # e.g. "Home", "Office", "SM North"
    latitude: float
    longitude: float
    radius_meters: float = 200  # geofence radius
    tags: List[str] = []        # optional: e.g. ["online", "food", "groceries"]
    created_at: datetime
    updated_at: datetime
```

**C# equivalent** — add `UserLocations` container and corresponding model + repository.

### 3. Location Matching (Python Ingester)

In `IngestionService.process_hook_async()`:
1. If `hook.latitude` and `hook.longitude` are present:
   - Load all `UserLocations` for the user (cached per user, 5-minute TTL).
   - For each location, compute **Haversine distance** from hook coordinates to location center.
   - Find the **closest match within radius**. If multiple locations overlap, use closest.
2. If a match is found:
   - Build a `location_context` string: `"The user was near their saved location 'Home' (within 150m) when this notification was received."`
   - Inject into the AI classification prompt as an additional context block.
3. If no match (or no lat/lng):
   - No location context injected — silent, no behavior change.

Location tags are passed as **soft hints only** — they do not override runbook rules or explicit vendor matches.

### 4. Location Rules — Runbook Integration

Location context is **surfaced through the existing runbook** — no new prompt template variable introduced.

Two things are appended to `runbook_content` at classification time:

#### A. Location Context Summary (always, when any locations are within range)

A summary block listing **all** `UserLocations` within their respective radii, sorted by distance. This gives the AI full awareness of where the user is, even for locations with no runbook rules.

```
## Location Context
The user's current location matches the following saved places:
- Home (42m away)
- Coffee Spot (118m away)
```

If no saved locations are within range, this block is omitted.

#### B. Location-Specific Runbook Rules (per matched location, if rules are defined)

For each matched location that has `runbook_rules` set, those rules are appended after the context summary:

```
## Rules when near Home
- Transactions here are likely online purchases or bills — do not expect a physical store vendor.
- If no vendor is identifiable, default to "Online Purchase".

## Rules when near Coffee Spot
- Vendor is likely a café. Default category: Food & Dining.
```

#### Combined injection into `runbook_content`:

```
{existing runbook content}

## Location Context
The user's current location matches the following saved places:
- Home (42m away)
- Coffee Spot (118m away)

## Rules when near Home
- Transactions here are likely online purchases or bills...

## Rules when near Coffee Spot
- Vendor is likely a café...
```

**No new prompt template variable is introduced.** `{runbook_content}` already exists in all classification prompts.

### 5. Backend REST API (C# Azure Functions)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/locations` | List all saved locations for authenticated user |
| `POST` | `/api/locations` | Create a new named location |
| `PUT` | `/api/locations/{id}` | Update name, radius, tags |
| `DELETE` | `/api/locations/{id}` | Delete a named location |

### 6. Frontend UI

#### Settings Page — "Saved Locations" section

- List of saved named locations with name, radius, and tag chips.
- **Add Location** button: opens modal with:
  - Name field (text input)
  - Radius slider (50m – 2000m, default 200m)
  - Tags input
  - **"Use Current Location"** button — reads browser `navigator.geolocation` and fills lat/lng.
  - Map preview (Leaflet.js — free, no API key) showing the geofence circle.
- Edit / Delete per location.

#### Pending Ingestion Review

- If `matched_location_name` is set, show a subtle badge: 📍 *Near Home* on the ingestion card/panel.
- Clicking the badge shows the matched location name and distance in meters.

---

## Data Flow

```
Phone sends hook (lat, lng in raw_payload)
        ↓
HookService.save_hook_async() → parses lat/lng → PhoneHookMessage.latitude/longitude
        ↓
IngestionService.process_hook_async()
        ↓
Load UserLocations (in-memory cache, 5min TTL) → Haversine match → closest within radius
        ↓
If match found AND location has runbook_rules:
    runbook_content += "\n" + matched_location.runbook_rules
        ↓
AI classification prompt ← {runbook_content} (now includes location rules)
        ↓
PendingIngestion saved with matched_location_name + matched_location_distance_m (for UI badge)
```

---

## Database Changes

| Store | Change |
|-------|--------|
| CosmosDB `PhoneHookMessages` | Add `latitude`, `longitude` (nullable float) |
| CosmosDB `UserLocations` | **New container**, partitioned by `/UserId` — includes `runbook_rules: Optional[str]` field |
| CosmosDB `PendingIngestions` | Add `matched_location_name: Optional[str]` and `matched_location_distance_m: Optional[float]` (for UI badge only) |
| C# `UserLocations` | New model + `IUserLocationRepository` + `UserLocationService` + CRUD Azure Functions |

---

## Model Updates

### `PhoneHookMessage` (Python + C# sync via model-syncer)
```python
class UserLocation(BaseModel):
    id: str
    user_id: str
    name: str                       # e.g. "Home", "Office"
    latitude: float
    longitude: float
    radius_meters: float = 200
    tags: List[str] = []            # informational only
    runbook_rules: Optional[str] = None  # plain-text rules appended to runbook_content when matched
    created_at: datetime
    updated_at: datetime
```

---

## Out of Scope

- Reverse geocoding (lat/lng → street address via external API).
- Auto-detecting nearby merchants via Google Places / Foursquare.
- Location history logging or analytics dashboard.
- Background location tracking (only the location at notification-received time is used).

---

## Open Questions

1. **Map UI**: Leaflet (free) is the default. Switch to Google Maps if Leaflet isn't expressive enough — will require API key + billing setup.
2. **Location runbook rules**: Rules are plain text, same format as the main runbook. The UI exposes a small text area in the "Edit Location" modal where the user writes classification rules for that location. These are appended to the main runbook at runtime — no new syntax or schema needed.
3. **Multiple overlapping locations**: Closest-wins is the default. Should the user be able to stack multiple location contexts (e.g., "Home" + "Home Office")?

---

## Verification Plan

### Automated Tests
- Unit test Haversine distance: known coordinates → expected distances (correct to ±1m).
- Unit test location matching: inside radius (match), outside radius (no match), multiple overlapping (closest wins).
- Unit test prompt injection: location present → `{location_context}` non-empty; no location → `{location_context}` is empty string.

### Manual Verification
1. Save "Home" location at current GPS, radius 200m.
2. Send mock hook with lat/lng within 200m of Home.
3. Verify `matched_location_name = "Home"` on resulting `PendingIngestion`.
4. Verify AI classification `why` field mentions the location context.
5. Send hook with lat/lng outside all saved locations.
6. Verify no location context injected; classification unchanged.
