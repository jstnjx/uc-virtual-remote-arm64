import { simDown } from "./simulator";

export default function globalTeardown(): void {
  simDown();
}
