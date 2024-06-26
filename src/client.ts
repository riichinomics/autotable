/* eslint no-console: 0 */

import { EventEmitter } from 'events';

import { Entry } from '../server/protocol';

import { BaseClient, Game } from './base-client';
import { ThingInfo, MatchInfo, MouseInfo, SoundInfo, SeatInfo } from './types';


export class Client extends BaseClient {
  match: Collection<number, MatchInfo>;
  seats: Collection<string, SeatInfo>;
  things: Collection<number, ThingInfo>;
  nicks: Collection<string, string>;
  mouse: Collection<string, MouseInfo>;
  sound: Collection<number, SoundInfo>;
  spectators: Collection<string, string>;

  seat: number | null = 0;
  seatPlayers: Array<string | null> = new Array(4).fill(null);

  constructor() {
    super();

    // Make sure match is first, as it triggers reorganization of slots and things.
    this.match = new Collection('match', this, { sendOnConnect: true }),

    this.seats = new Collection('seats', this, { unique: 'seat', perPlayer: true });
    this.things = new Collection('things', this, { unique: 'slotName', sendOnConnect: true });
    this.nicks = new Collection('nicks', this, { perPlayer: true });
    this.mouse = new Collection('mouse', this, { rateLimit: 100, perPlayer: true });
    this.sound = new Collection('sound', this, { ephemeral: true });
    this.spectators = new Collection('spectators', this, { writeProtected: false, perPlayer: true });
    this.seats.on('update', this.onSeats.bind(this));
  }

  private onSeats(): void {
    this.seat = null;
    this.seatPlayers.fill(null);
    for (const [playerId, seatInfo] of this.seats.entries()) {
      if (playerId === this.playerId()) {
        this.seat = seatInfo.seat;
      }
      if (seatInfo.seat !== null) {
        this.seatPlayers[seatInfo.seat] = playerId;
      }
    }
  }
}

interface CollectionOptions {
  // Key that has to be kept unique. Enforced by the server.
  // For example, for 'things', the unique key is 'slotName', and if you
  // attempt to store two things with the same slots, server will reject the
  // update.
  unique?: string;

  // Updates will be sent to other players, but not stored on the server (new
  // will not receive them on connection).
  ephemeral?: boolean;

  // This is a collection indexed by player ID, and values will be deleted
  // when a player disconnect.
  perPlayer?: boolean;

  // The server will not send all updates, but limit to N per second.
  rateLimit?: number;

  // Only authenticated clients can write to this collection
  writeProtected?: boolean;

  // If we are initializing the server (i.e. we're the first player), send
  // our value.
  sendOnConnect?: boolean;
}

export class Collection<K extends string | number, V> {
  public options: CollectionOptions;
  private kind: string;
  private client: Client;
  private map: Map<K, V> = new Map();
  private pending: Map<K, V | null> = new Map();
  private events: EventEmitter = new EventEmitter();
  private intervalId: NodeJS.Timeout | null = null;
  private lastUpdate: number = 0;

  constructor(
    kind: string,
    client: Client,
    options?: CollectionOptions) {

    this.kind = kind;
    this.client = client;
    this.options = options ?? {};

    this.client.on('update', this.onUpdate.bind(this));
    this.client.on('connect', this.onConnect.bind(this));
    this.client.on('disconnect', this.onDisconnect.bind(this));
  }

  entries(): Iterable<[K, V]> {
    return this.map.entries();
  }

  get(key: K): V | null {
    return this.map.get(key) ?? null;
  }

  update(localEntries: Array<[K, V | null]>): void {
    if (!this.options.writeProtected)  {
      this.cacheEntries(localEntries, false);
    }

    if(!this.client.connected()) {
      return;
    }

    const now = new Date().getTime();
    for (const [key, value] of localEntries) {
      this.pending.set(key, value);
    }
    if (!this.options.rateLimit || now > this.lastUpdate + this.options.rateLimit) {
      this.sendPending();
    }
  }

  set(key: K, value: V | null): void {
    this.update([[key, value]]);
  }

  on(what: 'update', handler: (localEntries: Array<[K, V | null]>, full: boolean) => void): void;
  on(what: 'optionsChanged', handler: (options: CollectionOptions) => void): void;
  on(what: string, handler: (...args: any[]) => void): void {
    this.events.on(what, handler);
  }

  setOption(option: keyof CollectionOptions, value: any) {
    if (this.options[option] === value) {
      return;
    }

    this.options[option] = value;
    this.client.update([[option, this.kind, value]]);
    this.events.emit("optionsChanged", this.options);
  }

  private onUpdate(entries: Array<Entry>, full: boolean): void {
    if (full) {
      this.map.clear();
    }

    for (const [kind, key, value] of entries) {
      if (key !== this.kind) {
        continue;
      }

      if (kind === "writeProtected") {
        if (this.options.writeProtected === value) {
          continue;
        }
        this.options.writeProtected = value;
        this.events.emit("optionsChanged", this.options);
      }
    }

    this.cacheEntries(
      entries.filter(([kind, _, __]) => kind === this.kind).map(([_, k, v]) => [k as K, v as V | null]),
      full,
    )
  }

  private cacheEntries(entries: Array<[K, V | null]>, full: boolean): void {
    const localEntries = [];
    for (const [key, value] of entries) {
      localEntries.push([key, value]);
      if (value !== null) {
        this.map.set(key as K, value);
      } else {
        this.map.delete(key as K);
      }
    }
    if (full || localEntries.length > 0) {
      this.events.emit('update', localEntries, full);
    }
  }

  private onConnect(game: Game, isFirst: boolean): void {
    if (isFirst) {
      if (this.options.unique) {
        this.client.update([['unique', this.kind, this.options.unique]]);
      }
      if (this.options.writeProtected) {
        this.client.update([['writeProtected', this.kind, true]]);
      }
      if (this.options.ephemeral) {
        this.client.update([['ephemeral', this.kind, true]]);
      }
      if (this.options.perPlayer) {
        this.client.update([['perPlayer', this.kind, true]]);
      }
      if (this.options.sendOnConnect) {
        const entries: Array<Entry> = [];
        for (const [key, value] of this.map.entries()) {
          entries.push([this.kind, key, value]);
        }
        this.client.update(entries);
      }
    }
    if (this.options.rateLimit) {
      this.intervalId = setInterval(this.sendPending.bind(this), this.options.rateLimit);
    }
  }

  private onDisconnect(game: Game | null): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (game && this.options.perPlayer) {
      const localEntries: Array<Entry> = [];
      for (const [key, value] of this.map.entries()) {
        localEntries.push([this.kind, key, null]);
        if (key === game.playerId) {
          localEntries.push([this.kind, 'offline', value]);
        }
      }
      this.onUpdate(localEntries, true);
    }
  }

  private sendPending(): void {
    if (this.pending.size > 0) {
      const entries: Array<Entry> = [];
      for (const [k, v] of this.pending.entries()) {
        entries.push([this.kind, k, v]);
      }
      this.client.update(entries);
      this.lastUpdate = new Date().getTime();
      this.pending.clear();
    }
  }
}
