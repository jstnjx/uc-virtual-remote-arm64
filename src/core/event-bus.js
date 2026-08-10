import { EventEmitter } from "node:events";

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.sequence = 0;
  }

  publish(type, data = {}) {
    const event = {
      id: ++this.sequence,
      type,
      timestamp: new Date().toISOString(),
      data
    };
    this.emit("event", event);
    this.emit(type, event);
    return event;
  }
}
