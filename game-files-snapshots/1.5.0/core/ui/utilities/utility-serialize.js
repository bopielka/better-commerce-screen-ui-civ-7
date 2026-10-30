const DEBUG_LOG_META_INFO = false;
const DEBUG_LOG_WRITES = false;
const DEBUG_LOG_READS = false;
const DEBUG_LOG_COMMITS = false;
const DEBUG_LOG_LAST_COMMIT = false;
const DEBUG_RUN_TEST = false;
const CATALOG_FORMAT_VERSION = 3;
function makeHash(preamble, key) {
  return Database.makeHash(preamble + key);
}
function internalRead(player, hash) {
  return player != null ? player.Tutorial.getProperty(hash) : GameTutorial.getProperty(hash);
}
function internalWrite(player, hash, value) {
  if (!player) {
    GameTutorial.setProperty(hash, value);
  } else {
    player.Tutorial.setProperty(hash, value);
  }
}
function loadKeys(player, preamble) {
  const hash = makeHash(preamble, "KEYS");
  const ids = internalRead(player, hash);
  return typeof ids === "string" && ids.length > 0 ? new Set(ids.split(",")) : /* @__PURE__ */ new Set();
}
function saveKeys(player, preamble, keys) {
  const hash = makeHash(preamble, "KEYS");
  internalWrite(player, hash, Array.from(keys).join(","));
}
class SerialObject {
  // saved hash values for fast lookup
  /**
   * CTOR
   * @param id name of the object
   * @param scope name used as part of the hash
   * @param catalogId untouched catalog id needed for tracking
   * @param player (null) set to a Player if not a world catalog
   */
  constructor(id, scope, catalogId, player = null) {
    this.id = id;
    this.scope = scope;
    this.catalogId = catalogId;
    this.player = player;
    this.hashPreamble = "_" + scope + "_" + id + "_";
    this.propertyKeys = loadKeys(this.player, this.hashPreamble);
    for (const key of this.propertyKeys) {
      this.hashCache.set(key, makeHash(this.hashPreamble, key));
    }
  }
  hashPreamble;
  // preamble for all keys in this object (e.g. "_MyStuff_OBJ_<objid>_")
  propertyKeys;
  // track keys written to this object for enumeration
  hashCache = /* @__PURE__ */ new Map();
  /**
   * Retrieves the hash for a key if it exists.
   * If not, generate the hash, save it, and return it.
   */
  getCachedHash(key) {
    let hash = this.hashCache.get(key);
    if (hash === void 0) {
      hash = makeHash(this.hashPreamble, key);
      this.hashCache.set(key, hash);
    }
    return hash;
  }
  /**
   * @returns a collection of IDs maintained by this object.
   */
  getKeys() {
    return this.propertyKeys;
  }
  /**
   * DEBUG Helper
   * @returns a comma-separated lsit of IDs maintained by this object.
   */
  getKeysAsString() {
    return [...this.propertyKeys].join(", ");
  }
  /**
   * Read a single value.
   * @returns the value for the given key, or undefined if not existing.
   */
  read(key) {
    const hash = this.getCachedHash(key);
    const value = internalRead(this.player, hash);
    if (DEBUG_LOG_READS) {
      console.log(
        `Catalog: (READ)  '${key}'(${hash}) = '${value}', player: ${this.player ? this.player.id : "*"}, key='${this.hashPreamble + key}'`
      );
    }
    return value;
  }
  /**
   * Request a write of a single value.
   * If the game store, the write happens immediate.
   * If a player store, the write is queued to be committed by the cache.
   * The commited value is signaled from the App side by an event.
   */
  write(key, value) {
    const hash = this.getCachedHash(key);
    if (DEBUG_LOG_WRITES) {
      console.log(
        `Catalog: (WRITE) '${key}'(${hash}) = '${value}', player: ${this.player ? this.player.id : "*"}, key='${this.hashPreamble + key}'`
      );
    }
    internalWrite(this.player, hash, value);
    if (!this.propertyKeys.has(key)) {
      this.propertyKeys.add(key);
      saveKeys(this.player, this.hashPreamble, this.propertyKeys);
    }
    if (this.player) {
      addTrackingEntry(this.player.id, hash, this.catalogId, this.id, key);
    }
  }
}
class Catalog {
  name;
  _player = null;
  _fileVersion = 0;
  _runningVersion = 0;
  _justCreated = false;
  hashPreamble;
  objectIDs;
  get fileVersion() {
    return this._fileVersion;
  }
  get runningVersion() {
    return this._runningVersion;
  }
  get justCreated() {
    return this._justCreated;
  }
  /**
   * CTOR
   */
  constructor(properties) {
    this.name = properties.name;
    this._player = properties.player ?? null;
    this._runningVersion = properties.version ?? 0;
    this.hashPreamble = "_" + this.name + "__";
    this.objectIDs = loadKeys(this._player, this.hashPreamble);
    this.realizeInfoBlock(this._runningVersion);
    if (this._player != null) {
      engine.on("PlayerDynamicPropertyChanged", this.onPlayerDynamicPropertyChanged, this);
      if (this._justCreated) {
        this.registerWithCatalogIndex();
      }
    }
  }
  /**
   * If a catalog ever needs to be explicitly cleaned up; call this.
   */
  dispose() {
    if (this._player != null) {
      engine.off("PlayerDynamicPropertyChanged", this.onPlayerDynamicPropertyChanged, this);
    }
  }
  /** Names of the objects stored in the catalog */
  getObjectIds() {
    return this.objectIDs;
  }
  /**
   * Register this catalog with the index, so that it can be enumerated.
   * This may be used in the future; such as if we prevent catalogs from
   * being copied across an age transition boundary, etc.
   */
  registerWithCatalogIndex() {
    const catalogsIndexHash = Database.makeHash("_catalogs_index");
    const catalogs = this._player.Tutorial.getProperty(catalogsIndexHash);
    let catalogNames = [];
    if (catalogs != void 0 && catalogs.length > 0) {
      catalogNames = catalogs.split(",");
      if (!catalogNames.includes(this.name)) {
        catalogNames.push(this.name);
      }
    } else {
      catalogNames = [this.name];
    }
    this._player.Tutorial.setProperty(catalogsIndexHash, catalogNames.join(","));
  }
  /** Listener for player property changes having been committed. */
  onPlayerDynamicPropertyChanged(data) {
    if (data.player !== this._player?.id) return;
    const trackingResult = removeTrackingEntry(data.player, data.keyHash);
    if (trackingResult.amount === 0) {
      window.dispatchEvent(
        new CatalogItemCommittedEvent(
          data.player,
          data.keyHash,
          trackingResult.catalogId,
          trackingResult.objectId,
          trackingResult.key
        )
      );
    }
    if (DEBUG_LOG_COMMITS) {
      console.log(
        `Catalog: (COMMIT) '${this.name}' cache for player ${data.player} ${trackingResult.amount == -1 ? "ignored" : "watching"} ${data.keyHash} = "${trackingResult.catalogId}:${trackingResult.objectId}:${trackingResult.key}".`
      );
    }
  }
  /**
   * Read/Write the meta information for this catalog.
   * @param version (0) The version of system-specific information.
   */
  realizeInfoBlock(version) {
    if (DEBUG_LOG_META_INFO) {
      console.log(`Catalog: '${this.name}' realizing info block. version: ${version}`);
    }
    const info = new SerialObject("INFO", this.name, this.name, this._player);
    const diskVersion = info.read("version");
    this._justCreated = diskVersion == null || diskVersion === void 0;
    this._fileVersion = this._justCreated ? version : diskVersion;
    if (DEBUG_LOG_META_INFO) {
      console.log(`Catalog: '${this.name}' diskVersion: ${diskVersion}`);
      console.log(`Catalog: '${this.name}' justCreated: ${this._justCreated}`);
      console.log(`Catalog: '${this.name}' fileVersion: ${this._fileVersion}`);
    }
    if (this._justCreated) {
      info.write("version", version);
      info.write("first_version", version);
      info.write("catalog_format", CATALOG_FORMAT_VERSION);
      info.write("created", Date.now());
      info.write("hosting", Network.getLocalHostingPlatform());
      if (DEBUG_LOG_META_INFO) {
        console.log(`Catalog: '${this.name}' is NEW -------------------------- `);
        console.log(`Catalog: '${this.name}'        version: ${version}`);
      }
    } else {
      if (DEBUG_LOG_META_INFO) {
        console.log(`Catalog: '${this.name}' is old -------------------------- `);
        console.log(`Catalog: '${this.name}'  diskVersion: ${diskVersion}`);
      }
      if (diskVersion < version) {
        console.log(
          `utility-serialize: Catalog object '${this.name}' in save file is ${diskVersion}, app wants ${version}.`
        );
        info.write("version", version);
      } else if (diskVersion > version) {
        console.warn(
          `utility-serialize: Catalog object '${this.name}' file version is NEWER than app.  File is ${diskVersion}, app is ${version}.`
        );
      }
    }
  }
  getObject(id) {
    if (!this.exists(id)) {
      this.objectIDs.add(id);
      saveKeys(this._player, this.hashPreamble, this.objectIDs);
    }
    return new SerialObject(id, this.name + "_OBJ", this.name, this._player);
  }
  exists(id) {
    return this.objectIDs.has(id);
  }
  /**
   * DEBUG Helper
   * Outputs the entire contents of the catalog to the console as an ASCII tree.
   * Flags values with "(PENDING #)" if they have outstanding cache commits.
   */
  dumpToLog() {
  }
}
const CatalogItemCommittedEventName = "catalog-item-committed";
class CatalogItemCommittedEvent extends CustomEvent {
  constructor(playerId, hash, catalogId, objectId, key) {
    super(CatalogItemCommittedEventName, { bubbles: false, detail: { playerId, hash, catalogId, objectId, key } });
  }
}
const pendingCommits = /* @__PURE__ */ new Map();
function getEntries(playerId) {
  if (!pendingCommits.has(playerId)) {
    pendingCommits.set(playerId, []);
  }
  return pendingCommits.get(playerId);
}
function addTrackingEntry(playerId, hash, catalogId, objectId, key) {
  const entries = getEntries(playerId);
  const entry = entries.find((e) => e.hash === hash);
  if (entry) {
    entry.outstanding++;
  } else {
    entries.push({ hash, catalogId, objectId, key, outstanding: 1 });
  }
}
function removeTrackingEntry(playerId, hash) {
  const entries = getEntries(playerId);
  const entryIndex = entries.findIndex((e) => e.hash === hash);
  if (entryIndex !== -1) {
    const entry = entries[entryIndex];
    entry.outstanding--;
    if (entry.outstanding <= 0) {
      if (DEBUG_LOG_LAST_COMMIT && !DEBUG_LOG_COMMITS) {
        console.log(
          `Catalog: (COMMIT) Last write for player ${playerId} commited "${hash}", key='${entry.key}'`
        );
      }
      entries.splice(entryIndex, 1);
    }
    return { amount: entry.outstanding, catalogId: entry.catalogId, objectId: entry.objectId, key: entry.key };
  }
  return { amount: -1, catalogId: "", objectId: "", key: "" };
}
if (DEBUG_RUN_TEST) {
  if (UI.isInGame()) {
    window.addEventListener(CatalogItemCommittedEventName, (event) => {
      const details = event.detail;
      console.log(
        `Catalog: (TEST) Event: catalog="${details.catalogId}", object="${details.objectId}", key="${details.key}",  (${details.hash}) for player ${details.playerId}`
      );
      if (details.catalogId === "BoomCatalog" && details.objectId === "fireworks" && details.key === "sparklers") {
        const newAmount = fireworks.read("sparklers");
        console.log("Catalog: (TEST) AFTER commit event...");
        console.log(`Catalog: (TEST) new amount = ${newAmount}`);
        myCatalog.dumpToLog();
      }
    });
    const myCatalog = new Catalog({
      name: "BoomCatalog",
      version: 1,
      player: Players.get(GameContext.localPlayerID)
    });
    const fireworks = myCatalog.getObject("fireworks");
    const num = fireworks.read("sparklers") ?? 0;
    fireworks.write("sparklers", num + 1);
    console.log("Catalog: (TEST) BEFORE commit event...");
    console.log(`Catalog: (TEST) old amount = ${fireworks.read("sparklers")}`);
    myCatalog.dumpToLog();
  }
}

export { Catalog, CatalogItemCommittedEvent, CatalogItemCommittedEventName, SerialObject, addTrackingEntry, removeTrackingEntry };
//# sourceMappingURL=utility-serialize.js.map
