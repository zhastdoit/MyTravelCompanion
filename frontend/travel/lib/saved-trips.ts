/**
 * Type for a row returned by `GET /api/trips`. Mirror of the projection in
 * `backend/cold_store.py::list_trips` — keep both in sync when adding fields.
 */
export interface SavedTripSummary {
  id: string;
  session_id: string;
  name: string;
  origin: string;
  destination: string;
  block_count: number;
  created_at: string;
  updated_at: string;
}

export interface SavedTripsResponse {
  trips: SavedTripSummary[];
}
