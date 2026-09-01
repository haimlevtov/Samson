/**
 * The coach action's state shape and its initial value.
 *
 * WHY these are not in actions.ts: a "use server" module may export async
 * functions and nothing else. Exporting a plain object from one compiles and
 * type-checks cleanly, then fails at module evaluation with "can only export
 * async functions, found object" — which takes down every page that imports it.
 */
import type { DeliveredPlan } from '@/src/persona/schema';

export interface DeliveryState {
  personaSlug: string | null;
  delivered: DeliveredPlan | null;
  gentle: boolean;
  error: string | null;
}

export const EMPTY_DELIVERY: DeliveryState = {
  personaSlug: null,
  delivered: null,
  gentle: false,
  error: null,
};
