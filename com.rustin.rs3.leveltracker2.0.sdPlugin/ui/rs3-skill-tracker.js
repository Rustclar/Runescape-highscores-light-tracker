(() => {
  const RS3_SKILLS = [
    { key: "overall", label: "Overall" },
    { key: "attack", label: "Attack" },
    { key: "defence", label: "Defence" },
    { key: "strength", label: "Strength" },
    { key: "constitution", label: "Constitution" },
    { key: "ranged", label: "Ranged" },
    { key: "prayer", label: "Prayer" },
    { key: "magic", label: "Magic" },
    { key: "cooking", label: "Cooking" },
    { key: "woodcutting", label: "Woodcutting" },
    { key: "fletching", label: "Fletching" },
    { key: "fishing", label: "Fishing" },
    { key: "firemaking", label: "Firemaking" },
    { key: "crafting", label: "Crafting" },
    { key: "smithing", label: "Smithing" },
    { key: "mining", label: "Mining" },
    { key: "herblore", label: "Herblore" },
    { key: "agility", label: "Agility" },
    { key: "thieving", label: "Thieving" },
    { key: "slayer", label: "Slayer" },
    { key: "farming", label: "Farming" },
    { key: "runecrafting", label: "Runecrafting" },
    { key: "hunter", label: "Hunter" },
    { key: "construction", label: "Construction" },
    { key: "summoning", label: "Summoning" },
    { key: "dungeoneering", label: "Dungeoneering" },
    { key: "divination", label: "Divination" },
    { key: "invention", label: "Invention" },
    { key: "archaeology", label: "Archaeology" },
    { key: "necromancy", label: "Necromancy" }
  ];

  const OSRS_SKILLS = [
    { key: "overall", label: "Overall" },
    { key: "attack", label: "Attack" },
    { key: "defence", label: "Defence" },
    { key: "strength", label: "Strength" },
    { key: "hitpoints", label: "Hitpoints" },
    { key: "ranged", label: "Ranged" },
    { key: "prayer", label: "Prayer" },
    { key: "magic", label: "Magic" },
    { key: "cooking", label: "Cooking" },
    { key: "woodcutting", label: "Woodcutting" },
    { key: "fletching", label: "Fletching" },
    { key: "fishing", label: "Fishing" },
    { key: "firemaking", label: "Firemaking" },
    { key: "crafting", label: "Crafting" },
    { key: "smithing", label: "Smithing" },
    { key: "mining", label: "Mining" },
    { key: "herblore", label: "Herblore" },
    { key: "agility", label: "Agility" },
    { key: "thieving", label: "Thieving" },
    { key: "slayer", label: "Slayer" },
    { key: "farming", label: "Farming" },
    { key: "runecraft", label: "Runecraft" },
    { key: "hunter", label: "Hunter" },
    { key: "construction", label: "Construction" }
  ];

  const DEFAULT_SETTINGS = {
    playerName: "",
    game: "rs3",
    skillKey: "overall",
    refreshSeconds: 300,
    refreshPreset: "5",
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
  let actionUUID = "com.rustin.rs3.leveltracker2.0.skilltracker";
  let lastCustomMinutes = Math.max(1, Math.round(DEFAULT_SETTINGS.refreshSeconds / 60));
  let inputTimer = null;

  const playerInput = document.querySelector("#playerName");
  const gameSelect = document.querySelector("#gameMode");
  const skillSelect = document.querySelector("#skillKey");
  const refreshPresetSelect = document.querySelector("#refreshPreset");
  const refreshCustomInput = document.querySelector("#refreshCustom");
  const refreshNote = document.querySelector("#refreshNote");
  const titleBoldInput = document.querySelector("#titleBold");
  const titleColorSelect = document.querySelector("#titleColor");
  const titleSizeSelect = document.querySelector("#titleSize");
  const saveButton = document.querySelector("#saveSettings");

  const getSkills = (game) => (game === "osrs" ? OSRS_SKILLS : RS3_SKILLS);

  const renderSkillOptions = (game, selectedKey) => {
    if (!skillSelect) return;
    const skills = getSkills(game);
    skillSelect.innerHTML = "";
    skills.forEach((skill) => {
      const option = document.createElement("option");
      option.value = skill.key;
      option.textContent = skill.label;
      skillSelect.appendChild(option);
    });
    const match = skills.find((skill) => skill.key === selectedKey);
    skillSelect.value = match ? match.key : skills[0]?.key ?? "overall";
  };

  const normalizeSettings = (settings = {}) => {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const game = merged.game === "osrs" ? "osrs" : "rs3";
    const skills = getSkills(game);
    const skillKey = skills.some((skill) => skill.key === merged.skillKey)
      ? merged.skillKey
      : "overall";
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
    const refreshPreset =
      typeof merged.refreshPreset === "string"
        ? merged.refreshPreset
        : DEFAULT_SETTINGS.refreshPreset;
    return {
      ...merged,
      playerName: typeof merged.playerName === "string" ? merged.playerName : "",
      game,
      skillKey,
      refreshSeconds,
      refreshPreset,
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
      playerName: playerInput?.value ?? "",
      game: gameSelect?.value ?? DEFAULT_SETTINGS.game,
      skillKey: skillSelect?.value ?? DEFAULT_SETTINGS.skillKey,
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
    if (playerInput) playerInput.value = settings.playerName ?? "";
    if (gameSelect) gameSelect.value = settings.game;
    renderSkillOptions(settings.game, settings.skillKey);
    if (refreshPresetSelect) {
      const minutes = Math.max(1, Math.round(settings.refreshSeconds / 60));
      const presetValues = ["5", "10", "30", "60"];
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

  gameSelect?.addEventListener("change", () => {
    const settings = readSettingsFromForm();
    renderSkillOptions(settings.game, settings.skillKey);
    handleFormChange();
  });
  skillSelect?.addEventListener("change", handleFormChange);
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
  playerInput?.addEventListener("input", handleFormChangeDebounced);
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
