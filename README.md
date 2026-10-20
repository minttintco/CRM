# Customer Sync Bridge

A tiny server that holds your CRM private API key server-side and
returns contacts in the shape the app's "Sync from CRM" button expects.

## Environment variables (set on your host)

| Var | What it is |
|-----|------------|
| CRM_API_BASE | Your CRM contacts API base URL |
| CRM_ACCESS_TOKEN | Private API access token |
| CRM_LOCATION_ID | Your sub-account's location id |
| CRM_API_VERSION | API version header (default 2021-07-28) |
| CRM_VEHICLE_FIELD | Custom-field id holding the vehicle |
| CRM_VIN_FIELD | Custom-field id holding the VIN |
| PORT | Port to listen on (most hosts set this) |

## Run it

npm install
npm start# CRM
