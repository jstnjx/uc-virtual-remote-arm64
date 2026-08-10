import { RemoteIrCodeFormat } from "@/types/enums.ts";
import type { IrEmitter } from "@/types/ir.ts";

/**
 * Whether a selected IR emitter can be used to learn a code, and if not, why.
 *
 * - `ready`: online and reports the `learning` capability.
 * - `offline`: the emitter is unreachable (`active === false`), e.g. it lost
 *   its network connection. Reported regardless of capabilities, because an
 *   offline device is the actionable problem and its capabilities may be
 *   omitted while it is down — it must not be mislabeled as unsupported.
 * - `unsupported`: online but missing (or without) the `learning` capability,
 *   or no emitter selected.
 */
export type IrLearnReadiness = "ready" | "offline" | "unsupported";

export function irLearnReadiness(
  emitter: IrEmitter | undefined,
): IrLearnReadiness {
  if (!emitter) {
    return "unsupported";
  }
  if (!emitter.active) {
    return "offline";
  }
  const supportsLearning =
    typeof emitter.capabilities !== "undefined" &&
    "learning" in emitter.capabilities;
  return supportsLearning ? "ready" : "unsupported";
}

export function detectCodeFormat(input: string) {
  // Attention: validation needs to be in sync with core service!
  // Allow a sequence of hex codes with the `+` character
  const hexPattern =
    /^\d{1,3};0x[a-fA-F0-9]{1,16};\d{1,2};\d{1,2}(?:\s*\+\s*\d{1,3};0x[a-fA-F0-9]{1,16};\d{1,2};\d{1,2})*$/;
  // Allow a sequence of PRONTO codes with the `+` character, or a single toggle code separated by the `|` character
  // Note: a normal space is required as PRONTO code separator, do not replace it with the \s whitespace character class!
  // Otherwise, the core service might reject other white spaces! The \s is only allowed around the `|` separator.
  const prontoPattern =
    /^0{4}(?: [a-fA-F0-9]{4}){5,}(?:(?:\s*\+\s*0{4}(?: [a-fA-F0-9]{1,4}){5,})*|\s*\|\s*0{4}(?: [a-fA-F0-9]{4}){5,})$/;

  if (hexPattern.test(input)) {
    return RemoteIrCodeFormat.HEX;
  } else if (prontoPattern.test(input)) {
    return RemoteIrCodeFormat.PRONTO;
  } else {
    return null;
  }
}
