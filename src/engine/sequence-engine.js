import { nowIso, sleep } from "../shared/util.js";
import { logger } from "../shared/logger.js";

const log = logger("sequence-engine");

export class SequenceEngine {
  constructor(platform) {
    this.platform = platform;
    this.running = new Map();
    this.activityGenerations = new Map();
  }

  async runActivity(id, action = "on") {
    const activity = this.platform.db.getActivity(id);
    if (!activity) throw new Error(`Activity ${id} not found`);
    const normalized = String(action).toLowerCase();
    if (!["on", "off"].includes(normalized)) throw new Error(`Unsupported activity action ${action}`);
    const sequence = normalized === "on" ? activity.sequence_on : activity.sequence_off;
    const startingState = normalized === "on" ? "STARTING" : "STOPPING";
    const finalState = normalized === "on" ? "ON" : "OFF";
    const generation = Number(this.activityGenerations.get(id) || 0) + 1;
    this.activityGenerations.set(id, generation);

    if (normalized === "on" && activity.options?.exclusive_group) {
      const conflicts = this.platform.db.listActivities().filter((item) =>
        item.id !== id && item.state === "ON" && item.options?.exclusive_group === activity.options.exclusive_group
      );
      for (const conflict of conflicts) await this.runActivity(conflict.id, "off");
    }

    this.platform.db.setActivityState(id, startingState);
    this.platform.events.publish("activity.change", this.platform.db.getActivity(id));
    try {
      const execution = await this.runSequence("activity", id, sequence, { activity_id: id, action: normalized });
      if (this.activityGenerations.get(id) === generation) {
        this.platform.db.setActivityState(id, finalState);
        this.platform.events.publish("activity.change", this.platform.db.getActivity(id));
      } else {
        log.info(`Activity ${id} ${normalized.toUpperCase()} completion was superseded by a newer command`);
      }
      return execution;
    } catch (error) {
      if (this.activityGenerations.get(id) === generation) {
        this.platform.db.setActivityState(id, "ERROR");
        this.platform.events.publish("activity.change", this.platform.db.getActivity(id));
      }
      throw error;
    }
  }

  async runMacro(id) {
    const macro = this.platform.db.getMacro(id);
    if (!macro) throw new Error(`Macro ${id} not found`);
    return this.runSequence("macro", id, macro.sequence, { macro_id: id });
  }

  async runSequence(kind, targetId, sequence, context = {}) {
    if (!Array.isArray(sequence)) throw new Error("Sequence must be an array");
    const execution = this.platform.db.createExecution(kind, targetId, sequence.length);
    const controller = new AbortController();
    this.running.set(execution.id, controller);
    this.platform.events.publish("execution.change", execution);
    try {
      await this.#execute(sequence, { ...context, execution_id: execution.id, execution }, controller.signal, 0, execution);
      const completed = this.platform.db.updateExecution(execution.id, {
        status: "COMPLETED",
        current_step: sequence.length,
        finished_at: nowIso()
      });
      this.platform.events.publish("execution.change", completed);
      return completed;
    } catch (error) {
      const status = controller.signal.aborted ? "CANCELLED" : "FAILED";
      const failed = this.platform.db.updateExecution(execution.id, {
        status,
        error: error.message,
        finished_at: nowIso()
      });
      this.platform.events.publish("execution.change", failed);
      throw error;
    } finally {
      this.running.delete(execution.id);
    }
  }

  cancel(executionId) {
    const controller = this.running.get(executionId);
    if (!controller) return false;
    controller.abort(new Error("Execution cancelled"));
    return true;
  }

  async #execute(sequence, context, signal, depth, execution) {
    if (depth > 8) throw new Error("Maximum sequence nesting depth exceeded");
    for (let index = 0; index < sequence.length; index += 1) {
      if (signal.aborted) throw signal.reason || new Error("Execution cancelled");
      const step = sequence[index] || {};
      if (depth === 0) {
        const updated = this.platform.db.updateExecution(execution.id, { current_step: index + 1 });
        this.platform.events.publish("execution.change", updated);
      }
      await this.#step(step, context, signal, depth);
    }
  }

  async #step(step, context, signal, depth) {
    const type = String(step.type || "");
    switch (type) {
      case "command": {
        const command = step.command || {};
        await this.platform.integrations.command(command.entity_id, command.cmd_id || command.command, command.params);
        return;
      }
      case "entity_command":
        await this.platform.integrations.command(step.entity_id, step.command || step.cmd_id, step.params);
        return;
      case "delay":
        await sleep(Number(step.delay ?? step.ms ?? step.duration_ms ?? 0), signal);
        return;
      case "macro": {
        const macro = this.platform.db.getMacro(step.macro_id);
        if (!macro) throw new Error(`Macro ${step.macro_id} not found`);
        await this.#execute(macro.sequence, { ...context, macro_id: macro.id }, signal, depth + 1, context.execution);
        return;
      }
      case "parallel": {
        const branches = Array.isArray(step.sequences) ? step.sequences : [];
        await Promise.all(branches.map((branch) => this.#execute(branch, context, signal, depth + 1, context.execution)));
        return;
      }
      case "condition": {
        const entity = this.platform.db.getConfiguredEntity(step.entity_id);
        const actual = step.attribute ? entity?.attributes?.[step.attribute] : entity?.attributes?.state;
        const expected = step.equals;
        const matches = step.not ? actual !== expected : actual === expected;
        const branch = matches ? step.then : step.else;
        if (Array.isArray(branch)) await this.#execute(branch, context, signal, depth + 1, context.execution);
        return;
      }
      case "set_activity_state": {
        const id = step.activity_id || context.activity_id;
        if (!id) throw new Error("set_activity_state requires activity_id");
        const activity = this.platform.db.setActivityState(id, String(step.state || "UNKNOWN"));
        this.platform.events.publish("activity.change", activity);
        return;
      }
      case "log":
        log.info(String(step.message || ""));
        return;
      default:
        throw new Error(`Unsupported sequence step type: ${type || "<empty>"}`);
    }
  }
}
