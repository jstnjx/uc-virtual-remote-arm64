import { ref } from "vue";
import type {
  ActiveSequence,
  MsgRunningSequence,
  SequenceStep,
} from "@/types/command";
import { ActiveSequenceState } from "@/types/enums";

import { useTiming } from "@/composables/timing";
import { deepClone } from "@/composables/dataHelper";

const { sleep } = useTiming();

export function useSequenceHandler(initialActiveSequence: ActiveSequence) {
  const activeSequence = ref<ActiveSequence>(initialActiveSequence);

  async function updateActiveSequence(data: MsgRunningSequence) {
    if (activeSequence.value.state === ActiveSequenceState.ERROR) {
      return false;
    }

    const newState = data.state.toUpperCase();

    if (newState === "TIMEOUT") {
      activeSequence.value.state = "ERROR";
      const stepItem = {
        index: activeSequence.value.steps.length,
        error: "error.TIMEOUT",
        state: "ERROR",
      } as SequenceStep;

      activeSequence.value.steps.push(stepItem);
      return false;
    }

    if (newState === "ON" || newState === "OFF" || newState === "COMPLETED") {
      finishSequence();
      return true;
    }

    activeSequence.value.state = newState;

    if (data.total_steps) {
      activeSequence.value.totalSteps = data.total_steps;
    }

    if (data.step) {
      if (data.step.index === activeSequence.value.steps.length) {
        activeSequence.value.steps.pop();
      }

      activeSequence.value.steps.push(data.step);

      if (data.step.state && data.step.state == "ERROR") {
        activeSequence.value.state = ActiveSequenceState.ERROR;
        return false;
      }
    }
  }

  async function finishSequence() {
    if (activeSequence.value.state === ActiveSequenceState.DONE) {
      return true;
    }

    activeSequence.value.state = ActiveSequenceState.DONE;
    await sleep(3000);
    if (activeSequence.value.state != ActiveSequenceState.ERROR) {
      clearActiveSequence();
    }
  }

  function clearActiveSequence() {
    activeSequence.value = deepClone(initialActiveSequence);
  }

  function hasActiveSequence(type?: string) {
    if (type) {
      return activeSequence.value.type == type;
    }

    return activeSequence.value.type != null;
  }

  function getSequenceItemStatus(index: number, type?: string) {
    if (
      (type && activeSequence.value.type != type) ||
      activeSequence.value.state.length < 1
    ) {
      return null;
    }

    if (
      activeSequence.value.steps.length == index + 1 &&
      activeSequence.value.state === ActiveSequenceState.DONE
    ) {
      return {
        state: "DONE",
      };
    } else if (
      activeSequence.value.steps.length == index + 1 &&
      activeSequence.value.state != ActiveSequenceState.ERROR
    ) {
      return {
        state: "WAITING",
      };
    } else if (activeSequence.value.steps.length < index + 1) {
      return {
        state: "IDLE",
      };
    }

    if (activeSequence.value.steps[index]) {
      const message = {} as any;
      const currentStep = activeSequence.value.steps[index];

      if (currentStep.state && currentStep.state == "ERROR") {
        message.state = "ERROR";

        if (currentStep.error) {
          message.errorMessage = currentStep.error;
        }
      } else {
        message.state = "DONE";
      }

      return message;
    }

    return null;
  }

  return {
    activeSequence,
    updateActiveSequence,
    clearActiveSequence,
    hasActiveSequence,
    getSequenceItemStatus,
  };
}
