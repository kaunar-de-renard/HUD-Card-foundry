// =====================
// === Formulaire UI ===
// =====================
class CardHudSettingsForm extends FormApplication {
  constructor(...args) {
    super(...args);
    this.configs = foundry.utils.deepClone(game.settings.get("my-card-hud", "deckConfigs"));
  }

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      title: "Configuration des Decks Cartes",
      id: "card-hud-settings",
      template: "modules/Cardame/templates/card-hud-settings.hbs",
      width: 600,
      height: "auto",
      closeOnSubmit: true
    });
  }

  getData() {
    return {
      configs: this.configs
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".add-deck").click(() => {
      const id = randomID();
      this.configs[id] = {
        name: "Nouveau Deck",
        deck: "",
        hand: "",
        discard: "",
        actorId: "",
        autoDraw: true,
        startDraw: true,
        startAmount: 3
      };
      this.render();
    });

    html.find(".remove-deck").click(ev => {
      const id = ev.currentTarget.dataset.id;
      delete this.configs[id];
      this.render();
    });
  }

  async _updateObject(event, formData) {
    const expanded = foundry.utils.expandObject(formData);
    console.log("📝 Formulaire envoyé :", formData);
    console.log("📦 Objet expandé :", expanded);

    await game.settings.set("my-card-hud", "deckConfigs", expanded.configs || {});
    console.log("✅ Enregistrement effectué !");
  }
}

// ==========================
// === Initialisation VTT ===
// ==========================
Hooks.once("init", function () {
  console.log("HUD Cartes | Initialisation...");

  game.settings.registerMenu("Cardame", "deck-config-menu", {
    name: "Configuration des Decks",
    label: "Configurer les decks",
    hint: "Définir les decks, mains et défausses liés à des tokens.",
    icon: "fas fa-cog",
    type: CardHudSettingsForm,
    restricted: false,
    config: true
  });

  game.settings.register("my-card-hud", "deckConfigs", {
    name: "Decks liés aux tokens",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register("my-card-hud", "interfacePosition", {
    name: "Position de l'interface HUD",
    scope: "client",
    config: false,
    type: Object,
    default: { top: "90%", left: "50%" }
  });
  
});


// ====================================
// === Bouton dans la barre de scène ===
// ====================================
Hooks.on("getSceneControlButtons", function (controls) {
  if (controls.tokens) {
    controls.tokens.tools["open-card-hud"] = {
      name: "open-card-hud",
      title: "Ouvrir HUD Cartes",
      icon: "fas fa-th-large",
      button: true,
      onChange: () => openDeckSelector(),
      visible: true,
      order: 50  
    };
  }
});

// ==================================
// === Sélecteur de deck à lancer ===
// ==================================
async function openDeckSelector() {
  const configs = game.settings.get("my-card-hud", "deckConfigs");
  console.log("🎴 Deck configs chargés :", configs);

  if (!configs || Object.keys(configs).length === 0) {
    ui.notifications.warn("Aucun deck configuré !");
    return;
  }

  const deckList = Object.entries(configs).map(([id, conf]) => {
    console.log("🧪 Deck ID :", id, "| Nom :", conf.name);
    return `<option value="${id}">${conf.name || "Deck sans nom"}</option>`;
  }).join("");

  new Dialog({
    title: "Choisir un Deck",
    content: `<p>Sélectionnez un deck :</p>
              <select id="deckChoice">${deckList}</select>`,
    buttons: {
      ok: {
        label: "Ouvrir",
        callback: html => {
          const deckId = html.find("#deckChoice").val();
          console.log("📦 Deck sélectionné :", deckId);
          if (deckId) launchCardInterface(configs[deckId]);
        }
      },
      cancel: {
        label: "Annuler"
      }
    }
  }).render(true);
}

// ==========================================
// === Fonction principale à compléter ===
// ==========================================
function sanitizeCardSort(card) {
  if (typeof card._source.sort !== "number") {
    card._source.sort = parseInt(card._source.sort ?? card.sort ?? 0, 10);
  }
}
const activeDecks = new Set();
const deckHooks = new Map(); // <actorId, hookFunction>
function extractActorId(combatant) {
  return combatant?.actorId ?? combatant?.token?.actorId ?? null;
}
function launchCardInterface(config) {
  const DECK_UUID = config.deck;
  const HAND_UUID = config.hand;
  const DISCARD_UUID = config.discard;
  const TARGET_ACTOR_ID = config.actorId;
  if (activeDecks.has(config.actorId)) {
    console.log(`⏭ HUD déjà actif pour ${config.name}, pas de hook dupliqué.`);
  } else {
    activeDecks.add(config.actorId);
    
    // HOOK POUR LE DÉBUT DE COMBAT (pioche de départ)
    const startHook = async (combat) => {
      const actor = game.actors.get(config.actorId);
      if (!actor || !config.startDraw) return;
  
      const actorToken = actor.getActiveTokens()[0];
      if (!actorToken) return;
  
      const deck = await fromUuid(config.deck);
      const hand = await fromUuid(config.hand);
      if (deck && hand) {
        try {
          await deck.deal([hand], config.startAmount ?? 1);
          console.log(`🚀 ${config.name} : pioche de départ (${config.startAmount}).`);
          updateInterface();
        } catch (err) {
          console.error("❌ Erreur de pioche initiale :", err);
        }
      }
    };
  

// HOOK POUR CHAQUE DÉBUT DE TOUR (pioche automatique)
const turnChangeHook = async (combat, changed) => {
  console.log("✅ Hook combatTurnChange déclenché : round", combat.round, "turn", combat.turn);

  const actor = game.actors.get(config.actorId);
  if (!actor) {
    console.log("⚠ Actor non trouvé pour config.actorId :", config.actorId);
    return;
  }

  // check si le combatant est bien dans le ptn de combat
  const activeCombatant = combat.combatant;
  if (!activeCombatant) return;

  if (activeCombatant.actorId !== actor.id || !config.autoDraw) {
    console.log("💡 Pas le bon acteur actif pour piocher");
    return;
  }

  const deck = await fromUuid(config.deck);
  const hand = await fromUuid(config.hand);
  if (deck && hand) {
    try {
      await deck.deal([hand], 1);
      console.log(`🎴 ${config.name} : pioche automatique (début du tour).`);
      updateInterface();
    } catch (err) {
      console.error("❌ Erreur de pioche automatique :", err);
    }
  }
};

// Branche les hooks
Hooks.on("combatStart", startHook);
Hooks.on("combatTurnChange", turnChangeHook);

  
    // stocke les deux hooks pour les désactiver a un moment ..... peut être....
    deckHooks.set(config.actorId, { startHook, turnChangeHook });
  
    console.log(`✅ Hooks combat v13 activés pour ${config.name}`);
  }
  
  
  
  
  const CSS_ID = "compactCardInterfaceCSS";
  let lastPosition = { top: "90%", left: "50%" };

  if (!document.getElementById(CSS_ID)) {
    const style = document.createElement("style");
    style.id = CSS_ID;
    style.innerHTML = `
#compactCardInterface {
  position: fixed;
  top: 90%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px;
  border-radius: 8px;
  box-shadow: 0 0 15px rgba(0, 0, 0, 0.5);
  font-family: "Arial", sans-serif;
  z-index: 9999;
  cursor: grab;
  width: auto;
  display: flex;
  flex-direction: column; /* <-- c'est ça qui force l'horizontal */
  flex-wrap: wrap;     /* pour autoriser retour à la ligne si trop de cartes */
  justify-content: center;
  align-items: center;
  justify-content: center;
  gap: 10px;
  max-width: 90vw;
  overflow: hidden;
}


#compactCardInterface .card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 140px;
  background-color: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 5px;
  padding: 5px;
  text-align: center;
  box-sizing: border-box;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  overflow: hidden;
}

#compactCardInterface .card-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap; /* pour que ça passe à la ligne si besoin */
  justify-content: center;
  gap: 10px;
}

#compactCardInterface .card:hover {
  transform: translateY(-6px);
  box-shadow: 0 0 10px rgba(255, 77, 77, 0.7);
  border-color: rgba(255, 77, 77, 1);
}

#compactCardInterface .card img {
  width: 60px;
  height: 90px;
  border-radius: 3px;
  margin-bottom: 5px;
  **object-fit: cover;**
}

#compactCardInterface .card span {
  color: #ff4d4d;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

#compactCardInterface .card .value {
  font-size: 10px;
  color: #ffffff;
  line-height: 1.2;
}

      #compactCardInterface .buttons {
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
        width: 100%;
      }
      #compactCardInterface .buttons button {
        background-color: #ff4d4d;
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 0 5px rgba(255, 0, 0, 0.5);
      }
      #compactCardInterface .buttons button:hover {
        background-color: #ff6666;
      }
    `;
    document.head.appendChild(style);
  }

  function makeDialogDraggable(el) {
    let isDragging = false, offsetX, offsetY;
    el.addEventListener("mousedown", (e) => {
      isDragging = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      el.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", (e) => {
      if (isDragging) {
        lastPosition = {
          top: `${e.clientY - offsetY}px`,
          left: `${e.clientX - offsetX}px`
        };
        el.style.left = lastPosition.left;
        el.style.top = lastPosition.top;
        el.style.transform = "none";
      }
    });
    document.addEventListener("mouseup", async () => {
      if (isDragging) {
        await game.settings.set("my-card-hud", "interfacePosition", lastPosition);
      }
      isDragging = false;
      el.style.cursor = "grab";
    });
  }
  

  async function updateInterface() {
    const hand = await fromUuid(HAND_UUID); 
    console.log("Hand loaded:", hand);
    for (let c of hand.cards.values()) {
      console.log("Card loaded:", c.name, "sort:", c.sort, "typeof sort:", typeof c.sort, "_source.sort:", c._source.sort, "typeof _source.sort:", typeof c._source.sort);
    }
    const discard = await fromUuid(DISCARD_UUID);
    const cardsInHand = Array.from(hand.cards.values());
    for (let card of cardsInHand) sanitizeCardSort(card);
    lastPosition = await game.settings.get("my-card-hud", "interfacePosition");
    document.getElementById("compactCardInterface")?.remove();
  
    const container = document.createElement("div");
    container.id = "compactCardInterface";
    container.innerHTML = `
    <div id="toggleSize" style="position: absolute; top: 5px; right: 5px; cursor: pointer; font-size: 16px;">&#9660;</div>
    <div id="contentArea">
      <div class="card-list">
        ${cardsInHand.map(card => {
          const shortName = card.name.length > 9 ? card.name.slice(0, 9) + "…" : card.name;
          const couleur = card.suit ?? "?";
          const valeur = card.value ?? "?";
          return `
            <div class="card" data-card-id="${card.id}">
              <img src="${card.img}" alt="${card.name}" />
              <span title="${card.name}">${shortName}</span>
              <span class="value">INT: ${valeur}</span>
              <span class="value">PA: ${couleur}</span>
            </div>`;
        }).join("")}
      </div>
      <div class="buttons">
        <button id="drawCards">Piocher</button>
        <button id="recoverCard">Récupérer</button>
        <button id="closeInterface">Fermer</button>
      </div>
    </div>
  `;
  
  
    document.body.appendChild(container);
    if (lastPosition?.top && lastPosition?.left) {
      container.style.top = lastPosition.top;
      container.style.left = lastPosition.left;
      container.style.transform = "none";
    }
    let isCollapsed = false;
    container.querySelector("#toggleSize").addEventListener("click", () => {
      isCollapsed = !isCollapsed;
      const contentArea = container.querySelector("#contentArea");
      if (isCollapsed) {
        contentArea.style.display = "none";
        container.style.height = "40px";  // uniquement le header visible
        container.style.width = "auto";   // facultatif
        container.style.overflow = "visible";
        container.querySelector("#toggleSize").innerHTML = "&#9654;";
      } else {
        contentArea.style.display = "";
        container.style.height = "auto";
        container.style.overflow = "visible";
        container.querySelector("#toggleSize").innerHTML = "&#9660;";
      }
    });

    container.querySelectorAll(".card").forEach(cardElem => {
      cardElem.addEventListener("click", async () => {
        const cardId = cardElem.dataset.cardId;
        const card = hand.cards.get(cardId);
        if (!card) return ui.notifications.error("Carte introuvable !");
        
        // Clone la carte
        let cardData = duplicate(card.toObject());
        
        // Corrige le champ sort
        cardData.sort = parseInt(cardData.sort ?? 0, 10);
        
        // Supprime la carte de la main
        await card.delete();
        
        // Ajoute la carte corrigée dans la défausse
        await discard.createEmbeddedDocuments("Card", [cardData]);
        

        if (typeof OrcnogFancyCardDealer !== "undefined") {
          OrcnogFancyCardDealer({ deckName: "Défausse" }).view(card.name, false, false, true);
        }
        await ChatMessage.create({
          content: `
            <div style="display: flex; align-items: center;">
              <img src="${card.img}" width="50" height="75" style="margin-right: 10px;" />
              <p><strong>${card.name}</strong> a été envoyée dans <em>Défausse</em>.</p>
            </div>`,
          whisper: ChatMessage.getWhisperRecipients("GM")
        });
        updateInterface();
      });
    });
  
    container.querySelector("#drawCards").addEventListener("click", async () => {
      const deck = await fromUuid(DECK_UUID);
      if (!deck) return;
      const numberOfCards = await new Promise(resolve => {
        new Dialog({
          title: "Piocher des Cartes",
          content: `<p>Combien de cartes ?</p><input type="number" id="drawAmount" value="1" min="1" style="width:100%;" autofocus />`,
          buttons: {
            ok: {
              label: "Piocher",
              callback: html => resolve(Number(html.find("#drawAmount").val()))
            },
            cancel: {
              label: "Annuler",
              callback: () => resolve(null)
            }
          }
        }).render(true);
      });
      if (numberOfCards > 0) {
        await deck.deal([hand], numberOfCards);
        updateInterface();
      }
    });
  
    container.querySelector("#recoverCard").addEventListener("click", async () => {
      const cardsInDiscard = Array.from(discard.cards.values());
      if (cardsInDiscard.length === 0) {
        ui.notifications.warn("Aucune carte dans la défausse.");
        return;
      }
  
      const options = cardsInDiscard.map(card => `<option value="${card.id}">${card.name}</option>`).join("");
      const { cardId, unmarkDrawn, shuffleDeck, sendToHand } = await new Promise(resolve => {
        new Dialog({
          title: "Récupérer une Carte",
          content: `
            <div>
              <p>Quelle carte voulez-vous récupérer ?</p>
              <select id="recoverSelect">${options}</select>
              <p><label><input type="checkbox" id="unmarkDrawn" checked/> Renvoyer dans le deck</label></p>
              <p><label><input type="checkbox" id="shuffleDeck" checked/> Mélanger la pioche</label></p>
              <p><label><input type="checkbox" id="sendToHand"/> Renvoyer dans la main</label></p>
            </div>`,
          buttons: {
            ok: {
              label: "Récupérer",
              callback: html => resolve({
                cardId: html.find("#recoverSelect").val(),
                unmarkDrawn: html.find("#unmarkDrawn")[0].checked,
                shuffleDeck: html.find("#shuffleDeck")[0].checked,
                sendToHand: html.find("#sendToHand")[0].checked
              })
            },
            cancel: {
              label: "Annuler",
              callback: () => resolve({})
            }
          },
          default: "ok"
        }).render(true);
      });
  
      if (!cardId) return;
      const card = discard.cards.get(cardId);
      if (!card) return ui.notifications.error("Carte introuvable dans la défausse.");
      const destination = await fromUuid(sendToHand ? HAND_UUID : DECK_UUID);
        if (!destination) return ui.notifications.error("Destination introuvable.");

        if (unmarkDrawn) await card.update({ drawn: false });

        // CLONAGE
        let cardData = duplicate(card.toObject());
        cardData.sort = parseInt(cardData.sort ?? 0, 10);

        // SUPPRESSION AVANT DEPLACEMENT
        await card.delete();

        // AJOUT DANS LA DESTINATION
        await destination.createEmbeddedDocuments("Card", [cardData]);

        if (shuffleDeck && !sendToHand) await destination.shuffle();
      
      updateInterface();
      
    });
  
    container.querySelector("#closeInterface").addEventListener("click", () => {
      document.getElementById("compactCardInterface")?.remove();
  
      if (activeDecks.has(config.actorId)) {
        const hooks = deckHooks.get(config.actorId);
        if (hooks) {
          Hooks.off("combatStart", hooks.startHook);
          Hooks.off("combatTurnChange", hooks.turnChangeHook);
          deckHooks.delete(config.actorId);
        }
        
        activeDecks.delete(config.actorId);
      }
    });
  
    makeDialogDraggable(container);
  }
  
  updateInterface();
}


  














  
