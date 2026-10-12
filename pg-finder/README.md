# PG Finder

Search, filter and map paying-guest (PG) accommodation, shortlist favourites and list your own PG.

## Run

```
cd pg-finder
npm start        # or: node server.js
```

Open http://localhost:3000. No dependencies to install (Node 18+). Set `PORT` to change the port.

## Features

- Search by name/locality; filter by city, max rent, gender, sharing and amenities; sort by rent or rating
- Detail view with description, house rules, call / WhatsApp / map links
- Shortlist (saved in your browser) with a "shortlisted only" filter
- Map view of the filtered results (Leaflet + OpenStreetMap, needs internet)
- "List your PG" form that saves through the API

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/listings` | All listings |
| GET | `/api/listings/:id` | One listing |
| POST | `/api/listings` | Create a listing (validated server-side) |

Data lives in `data/listings.json`. If the API is unavailable (e.g. static hosting), the
site falls back to that file and stores new listings in the browser's localStorage.
