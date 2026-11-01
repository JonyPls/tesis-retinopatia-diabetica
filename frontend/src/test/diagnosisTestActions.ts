import { act } from "@testing-library/react";
import type { DiagnosisHook } from "../features/diagnosis/types";

/** Revisión expresa de las fotografías de un fixture, antes de probar el procesamiento. */
export function confirmManualPhotos(result: { current: DiagnosisHook }) {
  const review = result.current.manualReview;
  if (!review) throw new Error("El fixture debe abrir primero la revisión manual.");
  act(() => result.current.confirmManualReview(review, true));
}
