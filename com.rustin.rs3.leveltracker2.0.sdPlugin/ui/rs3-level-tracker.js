(() => {
  const DEFAULT_SETTINGS = {
    playerName: "",
    mode: "hiscore",
    refreshSeconds: 300,
    showXp: false,
    titleColor: "#000000",
    titleSize: 22
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
  let actionUUID = "com.rustin.rs3.leveltracker2.0.leveltracker";

  const playerInput = document.querySelector("#playerName");
  const modeSelect = document.querySelector("#mode");
  const refreshPresetSelect = document.querySelector("#refreshPreset");
  const refreshCustomInput = document.querySelector("#refreshCustom");
  const refreshNote = document.querySelector("#refreshNote");
  const showXpInput = document.querySelector("#showXp");
  const titleColorSelect = document.querySelector("#titleColor");
  const titleSizeSelect = document.querySelector("#titleSize");
  const saveButton = document.querySelector("#saveSettings");
  const testButton = document.querySelector("#testPull");

  const normalizeSettings = (settings = {}) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const refreshSeconds = Number.isFinite(merged.refreshSeconds)
      ? Math.max(30, Math.floor(merged.refreshSeconds))
      : DEFAULT_SETTINGS.refreshSeconds;
    const mode = ALLOWED_MODES.includes(merged.mode) ? merged.mode : "hiscore";
    const titleColor = ALLOWED_COLORS.includes(merged.titleColor)
      ? merged.titleColor
      : DEFAULT_SETTINGS.titleColor;
    const titleSize = ALLOWED_SIZES.includes(String(merged.titleSize))
      ? Number.parseInt(String(merged.titleSize), 10)
      : DEFAULT_SETTINGS.titleSize;
    return { ...merged, refreshSeconds, mode, titleColor, titleSize };
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

  const requestSettings = () => {
    const targets = [];
    if (actionContext) targets.push(actionContext);
    if (context && context !== actionContext) targets.push(context);
    if (!targets.length) return;
    targets.forEach((target) =>
      send({ event: "getSettings", context: target })
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

  const requestTestPull = () => {
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
      playerName: playerInput?.value ?? "",
      mode: modeSelect?.value ?? DEFAULT_SETTINGS.mode,
      refreshSeconds:
        refreshPresetSelect?.value === "custom"
          ? Math.max(
              60,
              Number.parseInt(refreshCustomInput?.value ?? "", 10) * 60
            )
          : Number.parseInt(refreshPresetSelect?.value ?? "", 10) * 60,
      showXp: Boolean(showXpInput?.checked),
      titleColor: titleColorSelect?.value ?? DEFAULT_SETTINGS.titleColor,
      titleSize: Number.parseInt(titleSizeSelect?.value ?? "", 10)
    });

  const applySettingsToForm = (settings) => {
    if (playerInput) playerInput.value = settings.playerName;
    if (modeSelect) modeSelect.value = settings.mode;
    if (refreshPresetSelect) {
      const minutes = Math.max(1, Math.round(settings.refreshSeconds / 60));
      const presetValues = ["1", "5", "10", "30", "60", "360", "720", "1440"];
      refreshPresetSelect.value = presetValues.includes(String(minutes))
        ? String(minutes)
        : "custom";
    }
    if (refreshCustomInput) {
      refreshCustomInput.value = String(
        Math.max(1, Math.round(settings.refreshSeconds / 60))
      );
      const showCustom = refreshPresetSelect?.value === "custom";
      refreshCustomInput.style.display = showCustom ? "block" : "none";
      if (refreshNote) refreshNote.style.display = showCustom ? "block" : "none";
    }
    if (showXpInput) showXpInput.checked = settings.showXp;
    if (titleColorSelect) titleColorSelect.value = settings.titleColor;
    if (titleSizeSelect) titleSizeSelect.value = String(settings.titleSize);
  };

  const handleFormChange = () => {
    const settings = readSettingsFromForm();
    applySettingsToForm(settings);
    setSettings(settings);
    requestSave(settings);
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
    if (websocket.readyState === WebSocket.OPEN) {
      requestSettings();
    }
  };

  window.connectElgatoStreamDeck = connect;
  window.connectElgatoStreamDeckSocket = connect;

  playerInput?.addEventListener("input", handleFormChange);
  modeSelect?.addEventListener("change", handleFormChange);
  refreshPresetSelect?.addEventListener("change", () => {
    if (refreshCustomInput && refreshPresetSelect?.value === "custom") {
      refreshCustomInput.style.display = "block";
      if (refreshNote) refreshNote.style.display = "block";
    } else if (refreshCustomInput) {
      refreshCustomInput.style.display = "none";
      if (refreshNote) refreshNote.style.display = "none";
      if (refreshPresetSelect?.value) {
        refreshCustomInput.value = refreshPresetSelect.value;
      }
    }
    handleFormChange();
  });
  refreshCustomInput?.addEventListener("input", handleFormChange);
  showXpInput?.addEventListener("change", handleFormChange);
  titleColorSelect?.addEventListener("change", handleFormChange);
  titleSizeSelect?.addEventListener("change", handleFormChange);
  saveButton?.addEventListener("click", handleFormChange);
  testButton?.addEventListener("click", () => {
    handleFormChange();
    requestTestPull();
  });
})();
