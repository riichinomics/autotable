import $ from 'jquery';
import { Client } from "./client";
import { World } from "./world";
import { DealType, GameType, Conditions, Points, GAME_TYPES } from './types';
import { DEALS } from './setup-deal';
import { MainView } from './main-view';
import { SpectatorOverlay } from './spectator-overlay';
import { AssetLoader } from './asset-loader';
import { ObjectView } from './object-view';

export function setVisibility(element: HTMLElement, isVisible: boolean): void {
  if (isVisible) {
    element.setAttribute('style', '');
    return;
  }
  element.setAttribute('style', 'display:none !important');
}

export function parseTileString(tiles: string): Record<string, number> {
  const tileMap: Record<string, number> = {};
  for (const result of [..."mpsz"].map(g => new RegExp(`[1-9]+${g}`).exec(tiles))) {
    if(result === null) {
      continue;
    }
    const group = result[0];
    for (let i = 0; i < group.length - 1; i++) {
      const tile = group[i] + group[group.length - 1];
      tileMap[tile] = (tileMap[tile] ?? 0) + 1;
    }
  }
  return tileMap;
}

export function tileMapToString(tileMap: Record<string, number>): string {
  const groups: Record<string, string> = {};
  for (const [key, value] of Object.entries(tileMap).sort((a, b) => a[0].codePointAt(0) - b[0].codePointAt(0))) {
    groups[key[1]] = (groups[key[1]] ?? "") + key[0].repeat(value);
  }
  let desc = "";
  for (const group of ["m", "p", "s", "z"]) {
    if (!(group in groups)) {
      continue;
    }
    desc += groups[group] + group;
  }
  return desc;
}

export class GameUi {
  elements: {
    sidebarBody: HTMLDivElement;
    selection: HTMLDivElement;
    toggleSidebar: HTMLDivElement;
    deal: HTMLButtonElement;
    toggleDealer: HTMLButtonElement;
    toggleHonba: HTMLButtonElement;
    takeSeat: Array<HTMLButtonElement>;
    leaveSeat: HTMLButtonElement;
    toggleSetup: HTMLButtonElement;
    dealType: HTMLSelectElement;
    gameType: HTMLSelectElement;
    setupDesc: HTMLElement;
    aka: HTMLSelectElement;
    akaText: HTMLInputElement;
    points: HTMLSelectElement;
    nick: HTMLInputElement;
    toggleSpectatorPassword: HTMLButtonElement;
    spectatorPassword: HTMLInputElement;
    spectate: HTMLButtonElement;
    stopSpectate: HTMLButtonElement;
    spectators: HTMLDivElement;
    tableClothInput: HTMLInputElement;
    resetTableCloth: HTMLButtonElement;

    viewTop: HTMLDivElement;
    viewDora: HTMLDivElement;
    viewAuto: HTMLDivElement;
    viewHand: Array<HTMLDivElement>;
    viewCalls: Array<HTMLDivElement>;
  }

  private isSpectating: boolean = false;
  private readonly spectatorOverlay: SpectatorOverlay;

  constructor(
    private readonly client: Client,
    private readonly world: World,
    private readonly mainView: MainView,
    private readonly assetLoader: AssetLoader,
    private readonly objectView: ObjectView,
  ) {

    this.spectatorOverlay = new SpectatorOverlay(client, world);

    this.elements = {
      sidebarBody: document.getElementById('sidebar-body')! as HTMLDivElement,
      selection: document.getElementById('selection')! as HTMLDivElement,
      toggleSidebar: document.getElementById('toggle-sidebar')! as HTMLDivElement,
      deal: document.getElementById('deal') as HTMLButtonElement,
      toggleDealer: document.getElementById('toggle-dealer') as HTMLButtonElement,
      toggleHonba: document.getElementById('toggle-honba') as HTMLButtonElement,
      takeSeat: [],
      leaveSeat: document.getElementById('leave-seat') as HTMLButtonElement,
      toggleSetup: document.getElementById('toggle-setup') as HTMLButtonElement,
      dealType: document.getElementById('deal-type') as HTMLSelectElement,
      gameType: document.getElementById('game-type') as HTMLSelectElement,
      setupDesc: document.getElementById('setup-desc') as HTMLElement,
      aka: document.getElementById('aka') as HTMLSelectElement,
      akaText: document.getElementById('aka-text') as HTMLInputElement,
      points: document.getElementById('points') as HTMLSelectElement,
      nick: document.getElementById('nick')! as HTMLInputElement,
      toggleSpectatorPassword: document.getElementById('toggle-spectator-password') as HTMLButtonElement,
      spectatorPassword: document.getElementById('spectator-password') as HTMLInputElement,
      spectate: document.getElementById('spectate')! as HTMLButtonElement,
      stopSpectate: document.getElementById('stop-spectate')! as HTMLButtonElement,
      spectators: document.getElementById('spectators')! as HTMLDivElement,
      tableClothInput: document.getElementById('table-cloth-input')! as HTMLInputElement,
      resetTableCloth: document.getElementById('reset-table-cloth')! as HTMLButtonElement,

      viewTop: document.getElementById('view-top')! as HTMLDivElement,
      viewDora: document.getElementById('view-dora')! as HTMLDivElement,
      viewAuto: document.getElementById('view-auto')! as HTMLDivElement,
      viewHand: [],
      viewCalls: [],
    };

    for (let i = 0; i < 4; i++) {
      this.elements.takeSeat.push(document.querySelector(`.seat-button-${i} button`) as HTMLButtonElement);
      this.elements.viewHand.push(document.querySelector(`.player-display [data-seat="${i}"] .hand`) as HTMLDivElement);
      this.elements.viewCalls.push(document.querySelector(`.player-display [data-seat="${i}"] .calls`) as HTMLDivElement);
    }

    this.elements.nick.value = localStorage.getItem("nick") ?? "";
    this.setupEvents();
    this.setupDealButton();
  }

  private trySetSpectating(isSpectating: boolean): void {
    this.client.auth(this.elements.spectatorPassword.value).then(isAuthed => {
      if (!isAuthed && this.client.spectators.options.writeProtected) {
        return;
      }
      const nick = this.elements.nick.value.length > 0 ? this.elements.nick.value : "不明";
      this.client.spectators.set(this.client.playerId(), isSpectating ? nick : null);
    });
  }

  private onNickChange(): void {
    const nick = this.elements.nick.value;
    localStorage.setItem("nick", nick);
    this.client.nicks.set(this.client.playerId(), nick);
  }

  private setupEvents(): void {
    this.elements.toggleDealer.onclick = () => this.world.toggleDealer();
    this.elements.toggleHonba.onclick = () => this.world.toggleHonba();

    this.client.spectators.on('optionsChanged', (options) => {
      this.elements.toggleSpectatorPassword.innerText = `${options.writeProtected ? "Remove" : "Add"} Spectator Password`;
    });

    this.client.seats.on('update', this.updateSeats.bind(this));
    this.client.nicks.on('update', this.updateSeats.bind(this));
    this.client.spectators.on('update', (entries) => {
      const spectators = [...this.client.spectators.entries()].filter(([key, value]) => value !== null);
      setVisibility(this.elements.spectators, spectators.length > 0);
      for (const [key, value] of entries) {
        const element = document.querySelector(`[data-spectator-id='${key}']`)! as HTMLDivElement;
        if (value === null) {
          if (element) {
            element.remove();
          }
          continue;
        }

        if (element) {
          element.innerText = value;
          continue;
        }

        const spectatorName = document.createElement('div');
        spectatorName.className = "mt-2 badge badge-success w-100 py-2";
        spectatorName.dataset.spectatorId = key;
        spectatorName.innerText = value;
        this.elements.spectators.insertAdjacentElement('beforeend', spectatorName);
      }
      this.isSpectating = this.client.spectators.get(this.client.playerId()) !== null;
      this.spectatorOverlay.setEnabled(this.isSpectating);
      this.spectatorOverlay.setEnabled(this.isSpectating);
      setVisibility(this.elements.selection, !this.isSpectating);

      if (this.isSpectating) {
        this.mainView.setPerspective(true);
        this.mainView.spectateAuto();
      } else {
        this.mainView.spectateTop();
      }

      this.updateSeats();
    });

    this.client.on('connect', (_, __, password) => {
      if (!password) {
        return;
      }
      this.elements.spectatorPassword.value = password;
    });
    for (let i = 0; i < 4; i++) {
      this.elements.takeSeat[i].onclick = () => {
        this.objectView.rotateTableCloth(i);
        this.client.nicks.set(this.client.playerId(), this.elements.nick.value);
        this.client.seats.set(this.client.playerId(), { seat: i });
      };

      this.elements.viewHand[i].onclick = () => {
        this.mainView.spectateHand(i);
      };

      this.elements.viewCalls[i].onclick = () => {
        this.mainView.spectateCall(i);
      };
    }

    this.elements.toggleSidebar.onclick = () => {
      const isVisible = this.elements.sidebarBody.getAttribute("style")?.length! > 0;
      setVisibility(this.elements.sidebarBody, isVisible);
      this.elements.toggleSidebar.innerHTML = isVisible ? "&lsaquo;" : "&rsaquo;";
    };

    this.elements.leaveSeat.onclick = () => {
      this.client.seats.set(this.client.playerId(), { seat: null });
    };

    this.elements.viewTop.onclick = () => {
      this.mainView.spectateTop();
    };

    this.elements.viewAuto.onclick = () => {
      this.mainView.spectateAuto();
      this.updateSeats();
    };

    this.elements.viewDora.onclick = () => {
      this.mainView.spectateDora();
    };

    this.elements.resetTableCloth.onclick = () => {
      this.assetLoader.forgetTableCloth();
      this.objectView.resetTableCloth();
    };

    this.elements.nick.oninput = this.elements.nick.onchange = (event) => {
      this.onNickChange();
      if (!this.isSpectating) {
        return;
      }
      this.trySetSpectating(true);
    };

    this.elements.tableClothInput.onchange = (event) => {
      const reader = new FileReader();
      const input = event.target as HTMLInputElement;
      if (!input.files) {
        return;
      }

      const file = input.files[0];
      if (!file) {
        return;
      }

      reader.onload = (e) => {
        const url = e.target?.result as string;
        this.assetLoader.loadTableCloth(url).then(() => {
          this.objectView.setTableCloth();
        });
      };

      reader.readAsDataURL(input.files[0]);
    };

    this.elements.toggleSpectatorPassword.onclick = () => {
      this.client.auth(this.elements.spectatorPassword.value).then(isAuthed => {
        if (!isAuthed) {
          return;
        }
        this.client.spectators.setOption("writeProtected", !(this.client.spectators.options.writeProtected ?? false));
      });
    };

    this.elements.spectate.onclick = this.trySetSpectating.bind(this, true);
    this.elements.stopSpectate.onclick = this.trySetSpectating.bind(this, false);

    this.client.match.on('update', this.updateSetup.bind(this));
    this.elements.gameType.onchange = () => {
      this.updateVisibility();
      this.resetPoints();
    };
    this.updateSetup();

    this.elements.aka.onchange = this.updateAka.bind(this);
    this.elements.akaText.onblur = this.updateAkaText.bind(this);

    // Hack for settings menu
    const doNotClose = ['LABEL', 'SELECT', 'OPTION'];
    for (const menu of Array.from(document.querySelectorAll('.dropdown-menu'))) {
      $(menu.parentElement!).on('hide.bs.dropdown', (e: Event) => {
        // @ts-ignore
        const target: HTMLElement | undefined = e.clickEvent?.target;
        if (target && doNotClose.indexOf(target.tagName) !== -1) {
          e.preventDefault();
        }
      });
    }
  }

  private updateSetup(): void {
    const match = this.client.match.get(0);
    const conditions = match?.conditions ?? Conditions.initial();

    this.elements.aka.value = tileMapToString(conditions.aka);
    if (this.elements.aka.selectedIndex === -1) {
      this.elements.aka.value = "-";
    }
    this.elements.akaText.value = tileMapToString(conditions.aka);

    this.elements.points.value = conditions.points;
    this.elements.gameType.value = conditions.gameType;
    this.elements.setupDesc.textContent = Conditions.describe(conditions);

    this.updateVisibility();
  }

  private updateVisibility(): void {
    const gameType = this.elements.gameType.value as GameType;

    for (const option of Array.from(this.elements.dealType.querySelectorAll('option'))) {
      const dealType = option.value as DealType;
      if (DEALS[gameType][dealType] === undefined) {
        option.style.display = 'none';
      } else {
        option.style.display = 'block';
      }
    }

    const dealType = this.elements.dealType.value as DealType;
    if (DEALS[gameType][dealType] === undefined) {
      this.resetDealType();
    }
  }

  private resetPoints(): void {
    const gameType = this.elements.gameType.value as GameType;
    this.elements.points.value = GAME_TYPES[gameType].points;
  }

  private resetDealType(): void {
    const gameType = this.elements.gameType.value as GameType;

    for (const option of Array.from(this.elements.dealType.querySelectorAll('option'))) {
      const dealType = option.value as DealType;
      if (DEALS[gameType][dealType] !== undefined) {
        this.elements.dealType.value = dealType;
        break;
      }
    }
  }

  private updateAka(event: Event): void {
    if (this.elements.aka.value === "-") {
      return;
    }

    this.elements.akaText.value = this.elements.aka.value;
  }

  private updateAkaText(event: FocusEvent): void {
    this.elements.aka.value = "-";
    this.elements.akaText.value = tileMapToString(parseTileString(this.elements.akaText.value));
  }

  private updateSeats(): void {
    const toDisable = [
      this.elements.deal,
      this.elements.toggleDealer,
      this.elements.toggleHonba,
      this.elements.toggleSetup,
    ];

    setVisibility(this.elements.spectate.parentElement!, !this.isSpectating && this.client.seat === null);
    setVisibility(this.elements.stopSpectate.parentElement!, this.isSpectating);
    setVisibility(this.elements.leaveSeat.parentElement!, this.client.seat !== null);
    for (const button of toDisable) {
      button.disabled = this.client.seat === null;
    }
    setVisibility(document.querySelector('.seat-buttons')! as HTMLElement, this.client.seat === null && !this.isSpectating);

    if (this.client.seat === null) {
      for (let i = 0; i < 4; i++) {
        const playerId = this.client.seatPlayers[i];
        const button = document.querySelector(`.seat-button-${i} button`) as HTMLButtonElement;
        if (playerId !== null) {
          const nick = this.client.nicks.get(playerId) || 'Jyanshi';
          button.disabled = true;
          button.className = 'btn btn-secondary';
          button.textContent = nick;
        } else {
          button.className = 'btn btn-primary';
          button.disabled = false;
          button.textContent = 'Take seat';
        }
      }
    }
  }

  private setupDealButton(): void {
    const buttonElement = document.getElementById('deal')!;
    const progressElement = document.querySelector('#deal .btn-progress')! as HTMLElement;

    let startPressed: number | null = null;
    const transitionTime = 600;
    const waitTime = transitionTime + 0;

    const start = (): void => {
      if (startPressed === null) {
        progressElement.style.width = '100%';
        startPressed = new Date().getTime();
      }
    };
    const cancel = (): void => {
      progressElement.style.width = '0%';
      startPressed = null;
      buttonElement.blur();
    };
    const commit = (): void => {
      const deal = startPressed !== null && new Date().getTime() - startPressed > waitTime;
      progressElement.style.width = '0%';
      startPressed = null;
      buttonElement.blur();

      if (deal) {
        const dealType = this.elements.dealType.value as DealType;
        const gameType = this.elements.gameType.value as GameType;
        const aka = parseTileString(this.elements.akaText.value);
        const points = this.elements.points.value as Points;

        this.world.deal(dealType, gameType, aka, points);
        this.resetDealType();
        this.hideSetup();
      }
    };

    buttonElement.onmousedown = start;
    buttonElement.onmouseup = commit;
    buttonElement.onmouseleave = cancel;
  }

  private showSetup(): void {
    // @ts-ignore
    $('#setup-group').collapse('show');
  }

  private hideSetup(): void {
    // @ts-ignore
    $('#setup-group').collapse('hide');
  }

}
