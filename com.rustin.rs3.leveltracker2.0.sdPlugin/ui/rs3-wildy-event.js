(() => {
  const DEFAULT_SETTINGS = {
    eventMode: "next",
    eventName: "Infernal Star",
    refreshSeconds: 60,
    refreshPreset: "1",
    titleBold: true,
    titleColor: "#FFFFFF",
    titleSize: 24
  };

  const ALLOWED_COLORS = [
    "#000000",
    "#FFFFFF",
    "#DC2626",
    "#16A34A",
    "#2563EB",
    "#F59E0B",
    "#F97316",
    "#7C3AED",
    "#06B6D4",
    "#DB2777",
    "#6B7280"
  ];
  const ALLOWED_SIZES = ["16", "18", "20", "22", "24", "26", "28"];

  let websocket = null;
  let context = "";
  let actionContext = "";
  let actionUUID = "com.rustin.rs3.leveltracker2.0.wildy.event";
  let lastCustomMinutes = Math.max(1, Math.round(DEFAULT_SETTINGS.refreshSeconds / 60));
  let inputTimer = null;

  const eventModeSelect = document.querySelector("#eventMode");
  const eventNameSelect = document.querySelector("#eventName");
  const refreshPresetSelect = document.querySelector("#refreshPreset");
  const refreshCustomInput = document.querySelector("#refreshCustom");
  const refreshNote = document.querySelector("#refreshNote");
  const titleBoldInput = document.querySelector("#titleBold");
  const titleColorSelect = document.querySelector("#titleColor");
  const titleSizeSelect = document.querySelector("#titleSize");
  const saveButton = document.querySelector("#saveSettings");

  const normalizeSettings = (settings = {}) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const refreshSeconds = Number.isFinite(merged.refreshSeconds)
      ? Math.max(30, Math.floor(merged.refreshSeconds))
      : DEFAULT_SETTINGS.refreshSeconds;
    const titleColor = ALLOWED_COLORS.includes(merged.titleColor)
      ? merged.titleColor
      : DEFAULT_SETTINGS.titleColor;
    const titleBold = Boolean(merged.titleBold);
    const titleSize = ALLOWED_SIZES.includes(String(merged.titleSize))
      ? Number.parseInt(String(merged.titleSize), 10)
      : DEFAULT_SETTINGS.titleSize;
    const eventMode = merged.eventMode === "specific" ? "specific" : "next";
    const eventName =
      typeof merged.eventName === "string"
        ? merged.eventName
        : DEFAULT_SETTINGS.eventName;
    const refreshPreset =
      typeof merged.refreshPreset === "string"
        ? merged.refreshPreset
        : DEFAULT_SETTINGS.refreshPreset;
    return {
      ...merged,
      refreshSeconds,
      refreshPreset,
      eventMode,
      eventName,
      titleBold,
      titleColor,
      titleSize
    };
  };

  const send = (payload) => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      return;
    }
    websocket.send(JSON.stringify(payload));
  };

  const setSettings = (settings) => {
    const targets = [];
    if (actionContext) targets.push(actionContext);
    if (context && context !== actionContext) targets.push(context);
    if (!targets.length) return;
    targets.forEach((target) =>
      send({ event: "setSettings", context: target, payload: settings })
    );
  };

  const requestSave = (settings) => {
    const targets = [];
    if (actionContext) targets.push(actionContext);
    if (context && context !== actionContext) targets.push(context);
    if (!targets.length) return;
    targets.forEach((target) =>
      send({
        event: "sendToPlugin",
        action: actionUUID,
        context: target,
        payload: { event: "saveSettings", settings }
      })
    );
  };

  const requestRefresh = () => {
    const targets = [];
    if (actionContext) targets.push(actionContext);
    if (context && context !== actionContext) targets.push(context);
    if (!targets.length) return;
    targets.forEach((target) =>
      send({
        event: "sendToPlugin",
        action: actionUUID,
        context: target,
        payload: { event: "refresh" }
      })
    );
  };

  const readSettingsFromForm = () =>
    normalizeSettings({
      eventMode: eventModeSelect?.value ?? DEFAULT_SETTINGS.eventMode,
      eventName: eventNameSelect?.value ?? DEFAULT_SETTINGS.eventName,
      refreshPreset: refreshPresetSelect?.value ?? DEFAULT_SETTINGS.refreshPreset,
      refreshSeconds: (() => {
        if (refreshPresetSelect?.value === "custom") {
          const customValue = Number.parseInt(refreshCustomInput?.value ?? "", 10);
          if (Number.isFinite(customValue) && customValue >= 1) {
            lastCustomMinutes = customValue;
          }
          return lastCustomMinutes * 60;
        }
        const presetMinutes = Number.parseInt(refreshPresetSelect?.value ?? "", 10);
        if (Number.isFinite(presetMinutes) && presetMinutes >= 1) {
          lastCustomMinutes = presetMinutes;
          return presetMinutes * 60;
        }
        return DEFAULT_SETTINGS.refreshSeconds;
      })(),
      titleBold: Boolean(titleBoldInput?.checked),
      titleColor: titleColorSelect?.value ?? DEFAULT_SETTINGS.titleColor,
      titleSize: Number.parseInt(titleSizeSelect?.value ?? "", 10)
    });

  const applySettingsToForm = (settings) => {
    if (eventModeSelect) eventModeSelect.value = settings.eventMode;
    if (eventNameSelect) eventNameSelect.value = settings.eventName;
    if (refreshPresetSelect) {
      const minutes = Math.max(1, Math.round(settings.refreshSeconds / 60));
      const presetValues = ["1", "5", "10", "30", "60"];
      const preset =
        settings.refreshPreset ??
        (presetValues.includes(String(minutes)) ? String(minutes) : "custom");
      refreshPresetSelect.value = preset;
      if (refreshPresetSelect.value === "custom") {
        lastCustomMinutes = minutes;
      }
    }
    if (refreshCustomInput) {
      refreshCustomInput.value = String(lastCustomMinutes || 1);
      const showCustom = refreshPresetSelect?.value === "custom";
      refreshCustomInput.style.display = showCustom ? "block" : "none";
      if (refreshNote) refreshNote.style.display = showCustom ? "block" : "none";
    }
    if (titleBoldInput) titleBoldInput.checked = settings.titleBold;
    if (titleColorSelect) titleColorSelect.value = settings.titleColor;
    if (titleSizeSelect) titleSizeSelect.value = String(settings.titleSize);

    if (eventNameSelect) {
      eventNameSelect.disabled = settings.eventMode !== "specific";
    }
  };

  const handleFormChange = () => {
    const settings = readSettingsFromForm();
    applySettingsToForm(settings);
    setSettings(settings);
  };

  const handleFormChangeDebounced = () => {
    if (inputTimer) {
      clearTimeout(inputTimer);
    }
    inputTimer = setTimeout(() => {
      inputTimer = null;
      handleFormChange();
    }, 600);
  };

  const handleMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.event === "didReceiveSettings") {
      if (message.context && message.context !== context) {
        actionContext = message.context;
      }
      const settings = normalizeSettings(message.payload?.settings);
      applySettingsToForm(settings);
    }
  };

  const connect = (inPort, inUUID, inRegisterEvent, _inInfo, inActionInfo) => {
    context = inUUID;
    websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
    websocket.onopen = () => {
      send({ event: inRegisterEvent, uuid: inUUID });
    };
    websocket.onmessage = handleMessage;

    const actionInfo = JSON.parse(inActionInfo);
    if (actionInfo?.action) {
      actionUUID = actionInfo.action;
    }
    actionContext =
      actionInfo?.context ||
      actionInfo?.payload?.context ||
      actionInfo?.payload?.settings?.context ||
      inUUID ||
      "";
    const settings = normalizeSettings(actionInfo?.payload?.settings);
    applySettingsToForm(settings);
  };

  window.connectElgatoStreamDeck = connect;
  window.connectElgatoStreamDeckSocket = connect;

  eventModeSelect?.addEventListener("change", handleFormChange);
  eventNameSelect?.addEventListener("change", handleFormChange);
  refreshPresetSelect?.addEventListener("change", () => {
    if (refreshCustomInput && refreshPresetSelect?.value === "custom") {
      refreshCustomInput.style.display = "block";
      if (refreshNote) refreshNote.style.display = "block";
      refreshCustomInput.value = String(lastCustomMinutes || 1);
    } else if (refreshCustomInput) {
      refreshCustomInput.style.display = "none";
      if (refreshNote) refreshNote.style.display = "none";
      if (refreshPresetSelect?.value) {
        refreshCustomInput.value = refreshPresetSelect.value;
      }
    }
    handleFormChange();
  });
  refreshCustomInput?.addEventListener("input", handleFormChangeDebounced);
  titleBoldInput?.addEventListener("change", handleFormChange);
  titleColorSelect?.addEventListener("change", handleFormChange);
  titleSizeSelect?.addEventListener("change", handleFormChange);
  saveButton?.addEventListener("click", () => {
    handleFormChange();
    const settings = readSettingsFromForm();
    requestSave(settings);
    requestRefresh();
  });
})();
