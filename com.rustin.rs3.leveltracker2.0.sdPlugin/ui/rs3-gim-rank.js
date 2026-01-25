(() => {
  const DEFAULT_SETTINGS = {
    groupName: "",
    teamSize: 3,
    mode: "regular",
    showRank: true,
    showLevel: false,
    showXp: false,
    titleColor: "#000000",
    titleSize: 22
  };

  const ALLOWED_SIZES = ["2", "3", "4", "5"];
  const ALLOWED_MODES = ["regular", "competitive"];
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
  const ALLOWED_TITLE_SIZES = ["16", "18", "20", "22", "24", "26", "28"];

  let websocket = null;
  let context = "";
  let actionContext = "";
  let actionUUID = "com.rustin.rs3.leveltracker2.0.gimrank";

  const groupInput = document.querySelector("#groupName");
  const teamSizeSelect = document.querySelector("#teamSize");
  const modeSelect = document.querySelector("#mode");
  const showRankInput = document.querySelector("#showRank");
  const showLevelInput = document.querySelector("#showLevel");
  const showXpInput = document.querySelector("#showXp");
  const titleColorSelect = document.querySelector("#titleColor");
  const titleSizeSelect = document.querySelector("#titleSize");
  const saveButton = document.querySelector("#saveSettings");
  const testButton = document.querySelector("#testPull");

  const normalizeSettings = (settings = {}) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const teamSize = ALLOWED_SIZES.includes(String(merged.teamSize))
      ? Number.parseInt(String(merged.teamSize), 10)
      : DEFAULT_SETTINGS.teamSize;
    const mode = ALLOWED_MODES.includes(merged.mode)
      ? merged.mode
      : DEFAULT_SETTINGS.mode;
    const titleColor = ALLOWED_COLORS.includes(merged.titleColor)
      ? merged.titleColor
      : DEFAULT_SETTINGS.titleColor;
    const titleSize = ALLOWED_TITLE_SIZES.includes(String(merged.titleSize))
      ? Number.parseInt(String(merged.titleSize), 10)
      : DEFAULT_SETTINGS.titleSize;
    return { ...merged, teamSize, mode, titleColor, titleSize };
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
    const target = actionContext || context;
    if (!target) return;
    send({
      event: "sendToPlugin",
      action: actionUUID,
      context: target,
      payload: { event: "saveSettings", settings }
    });
  };

  const requestTestPull = () => {
    const target = actionContext || context;
    if (!target) return;
    send({
      event: "sendToPlugin",
      action: actionUUID,
      context: target,
      payload: { event: "testPull" }
    });
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

  const readSettingsFromForm = () =>
    normalizeSettings({
      groupName: groupInput?.value ?? "",
      teamSize: Number.parseInt(teamSizeSelect?.value ?? "", 10),
      mode: modeSelect?.value ?? DEFAULT_SETTINGS.mode,
      showRank: Boolean(showRankInput?.checked),
      showLevel: Boolean(showLevelInput?.checked),
      showXp: Boolean(showXpInput?.checked),
      titleColor: titleColorSelect?.value ?? DEFAULT_SETTINGS.titleColor,
      titleSize: Number.parseInt(titleSizeSelect?.value ?? "", 10)
    });

  const applySettingsToForm = (settings) => {
    if (groupInput) groupInput.value = settings.groupName;
    if (teamSizeSelect) teamSizeSelect.value = String(settings.teamSize);
    if (modeSelect) modeSelect.value = settings.mode;
    if (showRankInput) showRankInput.checked = settings.showRank;
    if (showLevelInput) showLevelInput.checked = settings.showLevel;
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

  groupInput?.addEventListener("input", handleFormChange);
  teamSizeSelect?.addEventListener("change", handleFormChange);
  modeSelect?.addEventListener("change", handleFormChange);
  showRankInput?.addEventListener("change", handleFormChange);
  showLevelInput?.addEventListener("change", handleFormChange);
  showXpInput?.addEventListener("change", handleFormChange);
  titleColorSelect?.addEventListener("change", handleFormChange);
  titleSizeSelect?.addEventListener("change", handleFormChange);
  saveButton?.addEventListener("click", handleFormChange);
  testButton?.addEventListener("click", () => {
    handleFormChange();
    requestTestPull();
  });
})();
