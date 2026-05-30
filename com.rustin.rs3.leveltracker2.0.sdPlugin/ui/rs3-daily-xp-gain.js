(() => {
  const DEFAULT_SETTINGS = {
    playerName: "",
    mode: "hiscore",
    refreshSeconds: 300,
    refreshPreset: "5",
    titleBold: true,
    titleColor: "#FFFFFF",
    titleSize: 24
  };
  const ALLOWED_MODES = [
    "hiscore",
    "hiscore_ironman",
    "hiscore_hardcore_ironman",
    "hiscore_oldschool",
    "hiscore_oldschool_ironman",
    "hiscore_oldschool_hardcore_ironman",
    "hiscore_oldschool_ultimate",
    "hiscore_oldschool_deadman",
    "hiscore_oldschool_seasonal"
  ];
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
  let actionUUID = "com.rustin.rs3.leveltracker2.0.dailyxpgain";
  let inputTimer = null;
  let lastCustomMinutes = Math.max(1, Math.round(DEFAULT_SETTINGS.refreshSeconds / 60));

  const playerInput = document.querySelector("#playerName");
  const modeSelect = document.querySelector("#mode");
  const refreshPresetSelect = document.querySelector("#refreshPreset");
  const refreshCustomInput = document.querySelector("#refreshCustom");
  const refreshNote = document.querySelector("#refreshNote");
  const titleBoldInput = document.querySelector("#titleBold");
  const titleColorSelect = document.querySelector("#titleColor");
  const titleSizeSelect = document.querySelector("#titleSize");
  const saveButton = document.querySelector("#saveSettings");
  const resetButton = document.querySelector("#resetToday");

  const normalizeSettings = (settings = {}) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const refreshSeconds = Number.isFinite(merged.refreshSeconds)
      ? Math.max(30, Math.floor(merged.refreshSeconds))
      : DEFAULT_SETTINGS.refreshSeconds;
    const mode = ALLOWED_MODES.includes(merged.mode) ? merged.mode : DEFAULT_SETTINGS.mode;
    const titleColor = ALLOWED_COLORS.includes(merged.titleColor)
      ? merged.titleColor
      : DEFAULT_SETTINGS.titleColor;
    const titleBold = Boolean(merged.titleBold);
    const titleSize = ALLOWED_SIZES.includes(String(merged.titleSize))
      ? Number.parseInt(String(merged.titleSize), 10)
      : DEFAULT_SETTINGS.titleSize;
    return {
      ...merged,
      playerName: typeof merged.playerName === "string" ? merged.playerName : "",
      refreshPreset:
        typeof merged.refreshPreset === "string"
          ? merged.refreshPreset
          : DEFAULT_SETTINGS.refreshPreset,
      refreshSeconds,
      mode,
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

  const getTargets = () => {
    const targets = [];
    if (actionContext) targets.push(actionContext);
    if (context && context !== actionContext) targets.push(context);
    return targets;
  };

  const setSettings = (settings) => {
    getTargets().forEach((target) =>
      send({ event: "setSettings", context: target, payload: settings })
    );
  };

  const requestSettings = () => {
    getTargets().forEach((target) => send({ event: "getSettings", context: target }));
  };

  const requestPluginEvent = (event, settings) => {
    getTargets().forEach((target) =>
      send({
        event: "sendToPlugin",
        action: actionUUID,
        context: target,
        payload: { event, settings }
      })
    );
  };

  const readSettingsFromForm = () =>
    normalizeSettings({
      playerName: playerInput?.value ?? "",
      mode: modeSelect?.value ?? DEFAULT_SETTINGS.mode,
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
    if (playerInput) playerInput.value = settings.playerName;
    if (modeSelect) modeSelect.value = settings.mode;
    if (refreshPresetSelect) {
      const minutes = Math.max(1, Math.round(settings.refreshSeconds / 60));
      const presetValues = ["1", "5", "10", "30", "60", "360", "720", "1440"];
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
      applySettingsToForm(normalizeSettings(message.payload?.settings));
    }
  };

  const connect = (inPort, inUUID, inRegisterEvent, _inInfo, inActionInfo) => {
    context = inUUID;
    websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
    websocket.onopen = () => {
      send({ event: inRegisterEvent, uuid: inUUID });
      requestSettings();
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
    applySettingsToForm(normalizeSettings(actionInfo?.payload?.settings));
  };

  window.connectElgatoStreamDeck = connect;
  window.connectElgatoStreamDeckSocket = connect;

  playerInput?.addEventListener("input", handleFormChangeDebounced);
  modeSelect?.addEventListener("change", handleFormChange);
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
    requestPluginEvent("saveSettings", readSettingsFromForm());
  });
  resetButton?.addEventListener("click", () => {
    handleFormChange();
    requestPluginEvent("markSeen", readSettingsFromForm());
  });
})();
