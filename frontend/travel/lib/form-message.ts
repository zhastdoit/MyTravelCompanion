import type { GroupAgreementResult } from "@/app/components/generative/group-agreement-form";
import type { FlightCheckoutResult } from "@/app/components/generative/flight-checkout-card";

/**
 * Encode a generative-UI form submission as a structured chat message.
 *
 * The `[form: NAME]` prefix is part of the contract with the backend
 * orchestrator (see `_recognize_form_submit` in `backend/orchestrator.py`):
 * the agents read it as the user's confirmation and skip re-asking the same
 * questions. Keep both sides aligned when adding new forms.
 */
export const encodeGroupAgreementMessage = (r: GroupAgreementResult): string => {
  const decision = r.approved ? "Approved" : "Rejected";
  const must = r.must_include_tags.length ? r.must_include_tags.join(",") : "none";
  const avoid = r.avoid_tags.length ? r.avoid_tags.join(",") : "none";
  return (
    `[form: GROUP_AGREEMENT] ${decision} budget=$${r.budget_ceiling_usd} ` +
    `pacing=${r.pacing} must_include=${must} avoid=${avoid}`
  );
};

export const encodeFlightCheckoutMessage = (r: FlightCheckoutResult): string => {
  return (
    `[form: FLIGHT_PICKER] Confirmed booking ` +
    `airline="${r.airline}" flight=${r.flightNumber} ` +
    `route=${r.origin}->${r.destination} price=$${r.priceUsd}`
  );
};
