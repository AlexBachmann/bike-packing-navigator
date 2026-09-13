# Google Places API (New) - $0.00 Out-of-Pocket Cost Architecture

## Overview
When extracting Points of Interest (POIs) along a bikepacking route, cost control is essential. Google's modern **Places API (New)** provides **5,000 requests per month completely FREE** under the **"Nearby Search (Pro)"** SKU tier.

By adhering strictly to the field mask and caching strategy below, the entire route enrichment process costs **$0.00**.

---

## 1. SKU Tier & Field Mask

| Parameter | Configuration | Cost Implication |
| :--- | :--- | :--- |
| **Endpoint** | `https://places.googleapis.com/v1/places:searchNearby` | Modern Places API (New) |
| **SKU Tier** | **Nearby Search (Pro)** | **5,000 calls / month FREE** |
| **Pro Field Mask** | `places.id,places.displayName,places.primaryType,places.types,places.formattedAddress,places.location,places.regularOpeningHours,places.googleMapsUri,places.businessStatus` | Strictly excludes Enterprise (phone numbers, website URIs) and Atmosphere (user ratings, reviews) to prevent tier escalation |

> [!WARNING]
> Never add `places.internationalPhoneNumber`, `places.websiteUri`, `places.rating`, or `places.reviews` to the `X-Goog-FieldMask` header. Requesting these fields automatically elevates the query to the Enterprise or Atmosphere tier ($40.00 / 1k requests).

---

## 2. Query Budgeting Example

- **Colorado Trail (515 miles)**:
  - 69 backcountry checkpoint queries (every 12 km)
  - 20 town center resupply queries
  - Total requests: **~89 requests** (< 2% of the free monthly 5,000 allowance).
- **Tour Divide (2,700 miles)**:
  - ~350 backcountry queries
  - ~120 town center queries
  - Total requests: **~470 requests** (~9.4% of free monthly allowance).

---

## 3. Persistent Local Caching

All raw API responses are keyed by coordinates, radius, and types, and saved to:
`route/places/.cache_places_api_<route_id>.json`

- If a query was previously executed, it is loaded instantly from disk in < 1ms with **zero network requests** and **zero API consumption**.
- Rerunning filter adjustments, distance calculations, or projections never incurs additional API calls.
