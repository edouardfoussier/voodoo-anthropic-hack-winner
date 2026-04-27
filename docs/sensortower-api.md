
# Sensor Tower API Context: Ad Intelligence Creatives

This file documents the Sensor Tower API pieces needed to gather mobile game
advertising data: app lookup, app metadata, top advertisers, top creatives,
app-specific creatives, media URLs, and store rankings.

It is intentionally limited to Sensor Tower API behavior.

## 1. Basics

| Thing | Value |
|---|---|
| Base URL | `https://api.sensortower.com` |
| Auth | Add `auth_token=<your_token>` as a query parameter on every request. |
| Rate limit | 6 requests per second |
| Response format | JSON |
| Usage headers | `x-api-usage-limit`, `x-api-usage-count` |
| API docs | `https://app.sensortower.com/api` requires login |

Common `{os}` path values:

```text
ios
android
unified
```

Search also supports:

```text
both_stores
```

Use `unified` for ad-intelligence creative endpoints when you want one app ID
that groups iOS and Android variants of the same game.

Common errors:


| Status | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| `401`  | Invalid or missing `auth_token`                          |
| `403`  | Token is valid but the organization lacks product access |
| `422`  | Missing or invalid query parameter                       |
| `429`  | Rate limit exceeded                                      |


## 2. Validated Endpoint Notes

These were validated from this workspace with the provided API token:

- `GET /v1/unified/search_entities`
- `GET /v1/both_stores/search_entities`
- `GET /v1/ios/apps`
- `GET /v1/android/apps`
- `GET /v1/unified/apps?app_id_type=unified`
- `GET /v1/unified/ad_intel/top_apps`
- `GET /v1/unified/ad_intel/creatives/top`
- `GET /v1/unified/ad_intel/creatives`
- `GET /v1/ios/ranking`
- `GET /v1/android/ranking`

Important observed differences:

- `top_apps` accepts `network=All Networks`.
- `creatives/top` rejected `network=All Networks`; use one network per request.
- `creatives/top` uses singular `network`.
- `creatives` uses plural `networks`.
- `creatives/top` uses `date` and `period`.
- `creatives` uses `start_date` and optional `end_date`.
- `/v1/unified/apps` requires `app_id_type`.
- The plain ad type `other` was rejected; use `image-other` or `video-other`.

## 3. Search Entities

Endpoint:

```text
GET /v1/{os}/search_entities
```

Purpose:

Resolve a game or publisher search term to Sensor Tower IDs.

Params:


| Param         | Required | Values / Notes                             |
| ------------- | -------- | ------------------------------------------ |
| `os`          | yes      | `ios`, `android`, `both_stores`, `unified` |
| `entity_type` | yes      | `app` or `publisher`                       |
| `term`        | yes      | Search string                              |
| `limit`       | no       | Result limit                               |
| `auth_token`  | yes      | API token                                  |


Example:

```text
GET https://api.sensortower.com/v1/unified/search_entities
  ?entity_type=app
  &term=royal%20match
  &limit=5
  &auth_token=XXX
```

Response notes:

- With `os=unified`, top-level `app_id` is the unified app ID.
- Unified app results can include nested `ios_apps` and `android_apps`.
- With `os=both_stores`, results are platform-specific app records.

Common response fields:

```text
app_id
name
publisher_name
publisher_id
humanized_name
icon_url
os
categories
entity_type
is_unified
ios_apps
android_apps
```

## 4. App Metadata

Endpoints:

```text
GET /v1/ios/apps
GET /v1/android/apps
GET /v1/unified/apps
```

Use `ios` or `android` for rich store metadata. Use `unified` for app ID
mapping.

### 4.1 iOS and Android App Metadata

Params:


| Param        | Required | Values / Notes                                     |
| ------------ | -------- | -------------------------------------------------- |
| `app_ids`    | yes      | Comma-separated iOS app IDs or Android package IDs |
| `country`    | no       | Country code, often defaults to `US`               |
| `include`    | no       | Optional include filter                            |
| `auth_token` | yes      | API token                                          |


Example:

```text
GET /v1/ios/apps
  ?app_ids=553834731
  &auth_token=XXX
```

Common response fields:

```text
apps[]
apps[].app_id
apps[].canonical_country
apps[].name
apps[].publisher_name
apps[].publisher_id
apps[].icon_url
apps[].os
apps[].active
apps[].url
apps[].categories
apps[].valid_countries
apps[].top_countries
apps[].release_date
apps[].updated_date
apps[].rating
apps[].price
apps[].global_rating_count
apps[].rating_count
apps[].description
apps[].screenshot_urls
apps[].tablet_screenshot_urls
apps[].unified_app_id
```

### 4.2 Unified App Metadata

Params:


| Param         | Required | Values / Notes                               |
| ------------- | -------- | -------------------------------------------- |
| `app_ids`     | yes      | Comma-separated IDs                          |
| `app_id_type` | yes      | `unified`, `android`, `itunes`, or `cohorts` |
| `auth_token`  | yes      | API token                                    |


Example:

```text
GET /v1/unified/apps
  ?app_ids=55c5028802ac64f9c0001faf
  &app_id_type=unified
  &auth_token=XXX
```

Common response fields:

```text
apps[]
apps[].unified_app_id
apps[].name
apps[].canonical_app_id
apps[].cohort_id
apps[].itunes_apps
apps[].android_apps
apps[].unified_publisher_ids
apps[].itunes_publisher_ids
apps[].android_publisher_ids
```

## 5. Top Advertisers or Publishers

Endpoint:

```text
GET /v1/{os}/ad_intel/top_apps
```

Purpose:

Return top advertising apps or publishers ranked by Share of Voice for a
category, country, network, and period.

Params:


| Param                     | Required | Values / Notes                                        |
| ------------------------- | -------- | ----------------------------------------------------- |
| `os`                      | yes      | `ios`, `android`, `unified`                           |
| `role`                    | yes      | `advertisers` or `publishers`                         |
| `date`                    | yes      | Period start date, `YYYY-MM-DD`                       |
| `period`                  | yes      | `week`, `month`, `quarter`                            |
| `category`                | yes      | Category ID, for example Puzzle = `7012`              |
| `country`                 | yes      | ISO-2 country code                                    |
| `network`                 | yes      | Single network or `All Networks`                      |
| `countries`               | no       | Multi-country filter; applies when `role=advertisers` |
| `custom_fields_filter_id` | no       | Advanced filtering                                    |
| `limit`                   | no       | Max 250                                               |
| `page`                    | no       | Page number                                           |
| `auth_token`              | yes      | API token                                             |


Example:

```text
GET /v1/unified/ad_intel/top_apps
  ?role=advertisers
  &date=2026-03-01
  &period=month
  &category=7012
  &country=US
  &network=TikTok
  &limit=20
  &auth_token=XXX
```

Example with all networks:

```text
GET /v1/unified/ad_intel/top_apps
  ?role=advertisers
  &date=2026-03-01
  &period=month
  &category=7012
  &country=US
  &network=All%20Networks
  &limit=20
  &auth_token=XXX
```

Validated response fields:

```text
apps[]
apps[].app_id
apps[].canonical_country
apps[].name
apps[].publisher_name
apps[].publisher_id
apps[].icon_url
apps[].os
apps[].id
apps[].entity_type
apps[].is_unified
apps[].sov
apps[].custom_tags
```

## 6. Top Market-Wide Creatives

Endpoint:

```text
GET /v1/{os}/ad_intel/creatives/top
```

Purpose:

Return top creative groups for a category, country, network, period, and ad type.

Params:


| Param               | Required | Values / Notes                                   |
| ------------------- | -------- | ------------------------------------------------ |
| `os`                | yes      | `ios`, `android`, `unified`                      |
| `date`              | yes      | Period start date, `YYYY-MM-DD`                  |
| `period`            | yes      | `week`, `month`, `quarter`                       |
| `category`          | yes      | Category ID, for example Puzzle = `7012`         |
| `country`           | yes      | ISO-2 country code                               |
| `network`           | yes      | One network only; `All Networks` was rejected    |
| `ad_types`          | yes      | Comma-separated ad type values                   |
| `limit`             | no       | Max 250                                          |
| `page`              | no       | Page number                                      |
| `placements`        | no       | Placement filter                                 |
| `video_durations`   | no       | Duration range filter                            |
| `aspect_ratios`     | no       | Aspect ratio filter                              |
| `banner_dimensions` | no       | Banner dimension filter                          |
| `new_creative`      | no       | `true` returns creatives first seen in the range |
| `auth_token`        | yes      | API token                                        |


Example:

```text
GET /v1/unified/ad_intel/creatives/top
  ?date=2026-03-01
  &period=month
  &category=7012
  &country=US
  &network=TikTok
  &ad_types=video,video-interstitial
  &aspect_ratios=9:16
  &video_durations=:15
  &new_creative=true
  &limit=50
  &auth_token=XXX
```

Validated response fields:

```text
count
available_networks
ad_units[]
ad_units[].id
ad_units[].app_id
ad_units[].network
ad_units[].phashion_group
ad_units[].ad_type
ad_units[].first_seen_at
ad_units[].last_seen_at
ad_units[].creatives[]
ad_units[].ad_formats
ad_units[].app_info
```

Fields inside `ad_units[].creatives[]`:

```text
id
creative_url
preview_url
thumb_url
video_duration
width
height
message
button_text
```

Notes:

- The response is ordered by the endpoint's top-creative ranking.
- In the validated response, individual `ad_units` did not include `sov`,
`share`, or `rank`.
- Use response order as rank unless your response includes an explicit rank.
- `creative_url` is the original media asset URL.
- `preview_url` and `thumb_url` are useful smaller representations when present.

## 7. Creatives for Specific Apps

Endpoint:

```text
GET /v1/{os}/ad_intel/creatives
```

Purpose:

Return creatives for specific advertiser apps.

Params:


| Param               | Required | Values / Notes                                   |
| ------------------- | -------- | ------------------------------------------------ |
| `os`                | yes      | `ios`, `android`, `unified`                      |
| `app_ids`           | yes      | Comma-separated app IDs                          |
| `start_date`        | yes      | Start date, `YYYY-MM-DD`                         |
| `end_date`          | no       | End date, `YYYY-MM-DD`; defaults to today        |
| `countries`         | yes      | Comma-separated ISO-2 country codes              |
| `networks`          | yes      | Comma-separated network names                    |
| `ad_types`          | yes      | Comma-separated ad type values                   |
| `limit`             | no       | Max 100                                          |
| `page`              | no       | Page number                                      |
| `display_breakdown` | no       | `true` includes `breakdown` and `top_publishers` |
| `placements`        | no       | Placement filter                                 |
| `video_durations`   | no       | Duration range filter                            |
| `aspect_ratios`     | no       | Aspect ratio filter                              |
| `banner_dimensions` | no       | Banner dimension filter                          |
| `new_creative`      | no       | `true` returns creatives first seen in the range |
| `auth_token`        | yes      | API token                                        |


Example:

```text
GET /v1/unified/ad_intel/creatives
  ?app_ids=5f16a8019f7b275235017614,55c5028802ac64f9c0001faf
  &start_date=2026-01-24
  &end_date=2026-04-23
  &countries=US
  &networks=TikTok,Instagram,Admob
  &ad_types=video,video-interstitial,playable,image,banner,full_screen
  &display_breakdown=true
  &limit=100
  &auth_token=XXX
```

Validated response fields:

```text
count
available_networks
ad_units[]
ad_units[].id
ad_units[].app_id
ad_units[].network
ad_units[].phashion_group
ad_units[].ad_type
ad_units[].first_seen_at
ad_units[].last_seen_at
ad_units[].creatives[]
ad_units[].ad_formats
ad_units[].share
ad_units[].breakdown
ad_units[].top_publishers
```

Fields inside `ad_units[].creatives[]`:

```text
id
creative_url
thumb_url
width
height
message
button_text
```

Notes:

- With `os=unified`, pass unified app IDs in `app_ids`.
- Sort `ad_units` by `share` descending to rank creatives among the selected
apps.
- `display_breakdown=true` adds `breakdown` and `top_publishers`.
- `limit` max is 100 for this endpoint.

## 8. Store Rankings

Endpoints:

```text
GET /v1/ios/ranking
GET /v1/android/ranking
```

Purpose:

Return app store chart rankings for a category, chart type, country, and date.

Params:


| Param        | Required | Values / Notes                                  |
| ------------ | -------- | ----------------------------------------------- |
| `os`         | yes      | `ios` or `android`                              |
| `category`   | yes      | iOS numeric category or Android category string |
| `chart_type` | yes      | Chart type                                      |
| `country`    | yes      | ISO-2 country code                              |
| `date`       | yes      | `YYYY-MM-DD`                                    |
| `limit`      | no       | May be ignored; slice locally if needed         |
| `auth_token` | yes      | API token                                       |


iOS example:

```text
GET /v1/ios/ranking
  ?category=7012
  &chart_type=topgrossingapplications
  &country=US
  &date=2026-04-23
  &auth_token=XXX
```

Android example:

```text
GET /v1/android/ranking
  ?category=game_puzzle
  &chart_type=topselling_free
  &country=US
  &date=2026-04-23
  &auth_token=XXX
```

Response fields:

```text
category
chart_type
country
date
ranking[]
```

## 9. Reference Values

### 9.1 iOS Game Category IDs

Use these for iOS endpoints and generally for `os=unified` ad-intel category
queries.


| ID     | Category     |
| ------ | ------------ |
| `6014` | Games        |
| `7001` | Action       |
| `7002` | Adventure    |
| `7003` | Casual       |
| `7004` | Board        |
| `7005` | Card         |
| `7006` | Casino       |
| `7009` | Family       |
| `7011` | Music        |
| `7012` | Puzzle       |
| `7013` | Racing       |
| `7014` | Role Playing |
| `7015` | Simulation   |
| `7016` | Sports       |
| `7017` | Strategy     |
| `7018` | Trivia       |
| `7019` | Word         |


### 9.2 Android Game Categories

Validated Android ranking category:

```text
game_puzzle
```

Other Android category values differ from iOS category IDs. Use Sensor Tower's
category mapping endpoint or docs when adding more Android categories.

### 9.3 Networks

Observed or documented network values:

```text
Adcolony
Admob
Applovin
BidMachine
Chartboost
Digital Turbine
Facebook
InMobi
Instagram
Line
Meta Audience Network
Mintegral
Moloco
Mopub
Pangle
Pinterest
Smaato
Snapchat
Supersonic
Tapjoy
TikTok
Twitter
Unity
Verve
Vungle
Youtube
```

Endpoint-specific network behavior:

```text
top_apps      network=All Networks accepted
creatives/top network=All Networks rejected
creatives     uses networks=<comma-separated networks>
```

### 9.4 Ad Types

Accepted ad type values:

```text
image
image-banner
image-interstitial
image-other
banner
full_screen
video
video-rewarded
video-interstitial
video-other
playable
interactive-playable
interactive-playable-rewarded
interactive-playable-other
```

Do not use:

```text
other
```

The API rejected plain `other` during validation.

### 9.5 Optional Creative Filters

Common optional filters:

```text
placements
video_durations
aspect_ratios
banner_dimensions
new_creative
```

Video duration syntax:

```text
:3      videos up to 3 seconds
10:30   videos longer than 10 seconds and up to 30 seconds
60:     videos longer than 60 seconds
```

Common aspect ratio buckets:

```text
9:16
4:5
1:1
16:9
```

Common banner dimensions:

```text
320x50
350x110
728x90
970x250
```

### 9.6 Countries

Common country codes:

```text
US
GB
CA
DE
FR
JP
KR
BR
MX
AU
IN
ID
RU
TR
```

The PDF referenced this country list:

```text
https://app.sensortower.com/api/ios/ad_intel/countries.json
```

### 9.7 iOS Ranking Chart Types

Common chart types:

```text
topfreeapplications
toppaidapplications
topgrossingapplications
```

iOS also supports iPhone/iPad-prefixed variants in some ranking contexts.

## 10. Media Asset URLs

Creative responses include URLs such as:

```text
creative_url
preview_url
thumb_url
```

These URLs point to media assets, commonly on S3:

```text
https://x-ad-assets.s3.amazonaws.com/...
```

Notes:

- The media URLs do not require `auth_token`.
- `creative_url` is usually the original image or video.
- `thumb_url` is usually a small image thumbnail.
- `preview_url` may be present for some videos or playable assets.
- Use HTTP headers to inspect large files before downloading, especially videos.

Example:

```powershell
curl.exe -I "https://x-ad-assets.s3.amazonaws.com/media_asset/<id>/media"
```

Useful response headers:

```text
Content-Type
Content-Length
Last-Modified
```

## 11. Common Query Patterns

### 11.1 Get top puzzle advertisers on TikTok

```text
GET /v1/unified/ad_intel/top_apps
  ?role=advertisers
  &date=2026-03-01
  &period=month
  &category=7012
  &country=US
  &network=TikTok
  &limit=20
  &auth_token=XXX
```

### 11.2 Get top puzzle creatives on TikTok

```text
GET /v1/unified/ad_intel/creatives/top
  ?date=2026-03-01
  &period=month
  &category=7012
  &country=US
  &network=TikTok
  &ad_types=video,video-interstitial,playable
  &limit=50
  &auth_token=XXX
```

### 11.3 Get creatives for known unified app IDs

```text
GET /v1/unified/ad_intel/creatives
  ?app_ids=5f16a8019f7b275235017614,55c5028802ac64f9c0001faf
  &start_date=2026-01-24
  &end_date=2026-04-23
  &countries=US
  &networks=Admob,TikTok,Unity
  &ad_types=video,video-interstitial,playable,image,banner,full_screen
  &display_breakdown=true
  &limit=100
  &auth_token=XXX
```

### 11.4 Resolve a search term to unified app ID

```text
GET /v1/unified/search_entities
  ?entity_type=app
  &term=royal%20match
  &limit=5
  &auth_token=XXX
```

### 11.5 Map unified app ID to platform app IDs

```text
GET /v1/unified/apps
  ?app_ids=55c5028802ac64f9c0001faf
  &app_id_type=unified
  &auth_token=XXX
```

## 12. Troubleshooting

If `creatives/top` returns 422:

- Check that `network` is a single valid network.
- Do not use `All Networks`.
- Check that `ad_types` contains accepted values.
- Check that `date`, `period`, `category`, and `country` are present.

If `creatives` returns 422:

- Check that `app_ids` are valid for the selected `{os}`.
- Check that `start_date` is present.
- Check that `countries` is present.
- Check that `networks` is present.
- Check that `ad_types` contains accepted values.

If `creatives` returns zero `ad_units`:

- Expand the date range.
- Add more networks.
- Add more ad types.
- Try multiple countries, for example `countries=US,GB,CA,AU`.
- Confirm that unified endpoints receive unified app IDs.

If `/v1/unified/apps` returns 422:

- Add `app_id_type=unified`, `android`, `itunes`, or `cohorts`.

If media downloads are slow:

- Check `Content-Length` first.
- Prefer `thumb_url` or `preview_url` when the original video is large.
- Keep download timeouts in scripts.

```

```

