(() => {
  const DEFAULT_SETTINGS = {
    groupName: "",
    teamSize: 3,
    mode: "regular",
    game: "rs3",
    refreshMinutes: 10,
    showRank: true,
    showLevel: false,
    showXp: false,
    titleBold: true,
    titleColor: "#FFFFFF",
    titleSize: 24,
    linkToMain: false
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
  let inputTimer = null;

  const groupInput = document.querySelector("#groupName");
  const teamSizeSelect = document.querySelector("#teamSize");
  const modeSelect = document.querySelector("#mode");
  const gameSelect = document.querySelector("#game");
  const mainSettingsSection = document.querySelector(".main-settings");
  const refreshPresetSelect = document.querySelector("#refreshPreset");
  const refreshCustomInput = document.querySelector("#refreshCustom");
  const refreshNote = document.querySelector("#refreshNote");
  const showRankInput = document.querySelector("#showRank");
  const showLevelInput = document.querySelector("#showLevel");
  const showXpInput = document.querySelector("#showXp");
  const titleBoldInput = document.querySelector("#titleBold");
  const titleColorSelect = document.querySelector("#titleColor");
  const titleSizeSelect = document.querySelector("#titleSize");
  const saveButton = document.querySelector("#saveSettings");

  const normalizeSettings = (settings = {}) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const teamSize = ALLOWED_SIZES.includes(String(merged.teamSize))
      ? Number.parseInt(String(merged.teamSize), 10)
      : DEFAULT_SETTINGS.teamSize;
    const mode = ALLOWED_MODES.includes(merged.mode)
      ? merged.mode
      : DEFAULT_SETTINGS.mode;
    const game = merged.game === "osrs" ? "osrs" : "rs3";
    const refreshMinutes = Number.isFinite(merged.refreshMinutes)
      ? Math.max(1, Math.floor(merged.refreshMinutes))
      : DEFAULT_SETTINGS.refreshMinutes;
    const titleBold = Boolean(merged.titleBold);
    const titleColor = ALLOWED_COLORS.includes(merged.titleColor)
      ? merged.titleColor
      : DEFAULT_SETTINGS.titleColor;
    const titleSize = ALLOWED_TITLE_SIZES.includes(String(merged.titleSize))
      ? Number.parseInt(String(merged.titleSize), 10)
      : DEFAULT_SETTINGS.titleSize;
    return {
      ...merged,
      teamSize,
      mode,
      game,
      refreshMinutes,
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

  const requestSettings = () => {
    const targets = [];
    if (actionContext) targets.push(actionContext);
    if (context && context !== actionContext) targets.push(context);
    if (!targets.length) return;
    targets.forEach((target) =>
      send({ event: "getSettings", context: target })
    );
  };

  const requestGlobalSettings = () => {
    if (!context) return;
    send({ event: "getGlobalSettings", context });
  };

  const readSettingsFromForm = () =>
    normalizeSettings({
      groupName: groupInput?.value ?? "",
      teamSize: Number.parseInt(teamSizeSelect?.value ?? "", 10),
      mode: modeSelect?.value ?? DEFAULT_SETTINGS.mode,
      game: gameSelect?.value ?? DEFAULT_SETTINGS.game,
      refreshPreset: refreshPresetSelect?.value ?? String(DEFAULT_SETTINGS.refreshMinutes),
      refreshMinutes:
        refreshPresetSelect?.value === "custom"
          ? Number.parseInt(refreshCustomInput?.value ?? "", 10)
          : Number.parseInt(refreshPresetSelect?.value ?? "", 10),
      showRank: Boolean(showRankInput?.checked),
      showLevel: Boolean(showLevelInput?.checked),
      showXp: Boolean(showXpInput?.checked),
      titleBold: Boolean(titleBoldInput?.checked),
      titleColor: titleColorSelect?.value ?? DEFAULT_SETTINGS.titleColor,
      titleSize: Number.parseInt(titleSizeSelect?.value ?? "", 10)
    });

  const applySettingsToForm = (settings) => {
    if (groupInput) groupInput.value = settings.groupName;
    if (teamSizeSelect) teamSizeSelect.value = String(settings.teamSize);
    if (modeSelect) modeSelect.value = settings.mode;
    if (gameSelect) gameSelect.value = settings.game;
    if (refreshPresetSelect) {
      const preset =
        settings.refreshPreset ??
        (["1", "5", "10", "30", "60", "360", "720", "1440"].includes(
          String(settings.refreshMinutes)
        )
          ? String(settings.refreshMinutes)
          : "custom");
      refreshPresetSelect.value = preset;
    }
    if (refreshCustomInput) {
      refreshCustomInput.value = String(settings.refreshMinutes);
      const showCustom = refreshPresetSelect?.value === "custom";
      refreshCustomInput.style.display = showCustom ? "block" : "none";
      if (refreshNote) refreshNote.style.display = showCustom ? "block" : "none";
    }
    if (showRankInput) showRankInput.checked = settings.showRank;
    if (showLevelInput) showLevelInput.checked = settings.showLevel;
    if (showXpInput) showXpInput.checked = settings.showXp;
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
      const settings = normalizeSettings(message.payload?.settings);
      applySettingsToForm(settings);
      return;
    }
    if (message.event === "didReceiveGlobalSettings") {
      const linkedActions = [
        "com.rustin.rs3.leveltracker2.0.gimrank.above.linked",
        "com.rustin.rs3.leveltracker2.0.gimrank.below.linked"
      ];
      if (linkedActions.includes(actionUUID)) {
        const mainSettings = normalizeSettings(message.payload?.settings?.gimMain);
        const current = readSettingsFromForm();
        const merged = {
          ...mainSettings,
          showRank: current.showRank,
          showLevel: current.showLevel,
          showXp: current.showXp,
          titleColor: current.titleColor,
          titleSize: current.titleSize
        };
        applySettingsToForm(merged);
      }
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
    const linkedActions = [
      "com.rustin.rs3.leveltracker2.0.gimrank.above.linked",
      "com.rustin.rs3.leveltracker2.0.gimrank.below.linked"
    ];
    if (linkedActions.includes(actionUUID)) {
      if (groupInput) groupInput.disabled = true;
      if (teamSizeSelect) teamSizeSelect.disabled = true;
      if (mainSettingsSection) mainSettingsSection.style.display = "none";
    } else {
      if (mainSettingsSection) mainSettingsSection.style.display = "";
    }
    if (websocket.readyState === WebSocket.OPEN) {
      requestSettings();
      requestGlobalSettings();
    }
  };

  window.connectElgatoStreamDeck = connect;
  window.connectElgatoStreamDeckSocket = connect;

  groupInput?.addEventListener("input", handleFormChangeDebounced);
  teamSizeSelect?.addEventListener("change", handleFormChange);
  modeSelect?.addEventListener("change", handleFormChange);
  gameSelect?.addEventListener("change", handleFormChange);
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
  refreshCustomInput?.addEventListener("input", handleFormChangeDebounced);
  showRankInput?.addEventListener("change", handleFormChange);
  showLevelInput?.addEventListener("change", handleFormChange);
  showXpInput?.addEventListener("change", handleFormChange);
  titleBoldInput?.addEventListener("change", handleFormChange);
  titleColorSelect?.addEventListener("change", handleFormChange);
  titleSizeSelect?.addEventListener("change", handleFormChange);
  saveButton?.addEventListener("click", () => {
    const settings = readSettingsFromForm();
    handleFormChange();
    requestSave(settings);
  });
})();
