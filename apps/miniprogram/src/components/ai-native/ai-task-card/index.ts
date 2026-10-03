Component({
  properties: {
    task: { type: Object, value: null },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onOpen() {
      const task = this.data.task as { id?: string } | null;
      if (!this.data.disabled && task?.id) this.triggerEvent("open", { taskId: task.id });
    },
  },
});
