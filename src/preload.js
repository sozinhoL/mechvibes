'use strict';

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
// const gkm = require('gkm');
const { Howl } = require('howler');
const { shell } = require('electron');
const glob = require('glob');
const iohook = require('iohook');
const path = require('path');
const { ipcRenderer } = require('electron');
const { platform } = process;

const remapper = require('./utils/remapper');

const MV_PACK_LSID = 'mechvibes-saved-pack';
const MV_VOL_LSID = 'mechvibes-saved-volume';

const CUSTOM_PACKS_DIR = path.join(__dirname, '../../../custom');
const OFFICIAL_PACKS_DIR = path.join(__dirname, './audio');

let app_current_version = null;
let current_pack = null;
let packs = [];
let current_key_down = null;
const all_sound_files = {};

// ==================================================
// load all pack
async function loadPacks(status_display_elem, app_body) {
  // init
  status_display_elem.innerHTML = 'Carregando...';
  packs = [];

  // get all audio folders
  const official_packs = await glob.sync(OFFICIAL_PACKS_DIR + '/*/');
  const custom_packs = await glob.sync(CUSTOM_PACKS_DIR + '/*/');
  const folders = [...official_packs, ...custom_packs];

  // get pack data
  folders.map(folder => {
    // define group by types
    const is_custom = folder.indexOf('/custom/') > -1 ? true : false;

    // get folder name
    const splited = folder.split('/');
    const folder_name = splited[splited.length - 2];

    // define config file path
    const config_file = `${folder.replace(/\/$/, '')}/config.json`;

    // get pack info and defines data
    const { name, includes_numpad, sound = '', defines, key_define_type = 'single' } = require(config_file);

    // pack sound pack data
    const pack_data = {
      pack_id: `${is_custom ? 'custom' : 'default'}-${folder_name}`,
      group: is_custom ? 'Custom' : 'Default',
      abs_path: folder,
      key_define_type,
      name,
      includes_numpad,
    };

    // init sound data
    if (key_define_type == 'single') {
      // define sound path
      const sound_path = `${folder}${sound}`;
      const sound_data = new Howl({ src: [sound_path], sprite: keycodesRemap(defines) });
      Object.assign(pack_data, { sound: sound_data });
      all_sound_files[pack_data.pack_id] = false;
      // event when sound loaded
      sound_data.once('load', function() {
        all_sound_files[pack_data.pack_id] = true;
        checkIfAllSoundLoaded(status_display_elem, app_body);
      });
    } else {
      const sound_data = {};
      Object.keys(defines).map(kc => {
        if (defines[kc]) {
          // define sound path
          const sound_path = `${folder}${defines[kc]}`;
          sound_data[kc] = new Howl({ src: [sound_path] });
          all_sound_files[`${pack_data.pack_id}-${kc}`] = false;
          // event when sound_data loaded
          sound_data[kc].once('load', function() {
            all_sound_files[`${pack_data.pack_id}-${kc}`] = true;
            checkIfAllSoundLoaded(status_display_elem, app_body);
          });
        }
      });
      if (Object.keys(sound_data).length) {
        Object.assign(pack_data, { sound: keycodesRemap(sound_data) });
      }
    }

    // push pack data to pack list
    packs.push(pack_data);
  });

  // end load
  return;
}

// ==================================================
// check if all packs loaded
function checkIfAllSoundLoaded(status_display_elem, app_body) {
  Object.keys(all_sound_files).map(key => {
    if (!all_sound_files[key]) {
      loaded = false;
      return false;
    }
  });
  status_display_elem.innerHTML = 'Mechvibes';
  app_body.classList.remove('loading');
  loaded = true;
  return true;
}

// ==================================================
// remap keycodes from standard to os based keycodes
function keycodesRemap(defines) {
  const sprite = remapper('standard', platform, defines);
  Object.keys(sprite).map(kc => {
    sprite[`keycode-${kc}`] = sprite[kc];
    delete sprite[kc];
  });
  return sprite;
}

// ==================================================
// get pack by id,
// if id is null,
// get saved pack
function getPack(pack_id = null) {
  if (!pack_id) {
    if (localStorage.getItem(MV_PACK_LSID)) {
      pack_id = localStorage.getItem(MV_PACK_LSID);
      if (!getPack(pack_id)) {
        return packs[0];
      }
    } else {
      return packs[0];
    }
  }
  localStorage.setItem(MV_PACK_LSID, pack_id);
  return packs.find(pack => pack.pack_id == pack_id);
}

// ==================================================
// transform pack to select option list
function packsToOptions(packs, pack_list, onselect) {
  // get saved pack id
  const selected_pack_id = localStorage.getItem(MV_PACK_LSID);
  const groups = [];
  packs.map(pack => {
    const exists = groups.find(group => group.id == pack.group);
    if (!exists) {
      const group = {
        id: pack.group,
        name: pack.group || 'Default',
        packs: [pack],
      };
      groups.push(group);
    } else {
      exists.packs.push(pack);
    }
  });

  for (let group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.name;
    for (let pack of group.packs) {
      // check if selected
      const is_selected = selected_pack_id == pack.pack_id;
      if (is_selected) {
        // pack current pack to saved pack
        current_pack = pack;
      }
      // add pack to pack list
      const opt = document.createElement('option');
      opt.text = pack.name;
      opt.value = pack.pack_id;
      opt.selected = is_selected ? 'selected' : false;
      optgroup.appendChild(opt);
    }
    pack_list.appendChild(optgroup);
  }

  // on select an option
  // update saved list id
  pack_list.addEventListener('change', e => {
    const selected_id = e.target.options[e.target.selectedIndex].value;
    localStorage.setItem(MV_PACK_LSID, selected_id);
    current_pack = getPack();
    current_pack_id = current_pack.pack_id;
  });
}

// ==================================================
// main
(function(window, document) {
  window.addEventListener('DOMContentLoaded', async () => {
    const version = document.getElementById('app-version');
    const update_available = document.getElementById('update-available');
    const new_version = document.getElementById('new-version');
    const open_custom_sound_pack_button = document.getElementById('open-custom-pack-folder');
    const open_editor_button = document.getElementById('open-editor');
    // request current app version
    ipcRenderer.send('app_version');
    ipcRenderer.on('app_version', (event, arg) => {
      ipcRenderer.removeAllListeners('app_version');
      version.innerText = arg.version;
      app_current_version = arg.version;
    });

    // open custom sound pack folder
    open_custom_sound_pack_button.addEventListener('click', () => {
      shell.showItemInFolder(CUSTOM_PACKS_DIR);
    });

    // open editor
    open_editor_button.addEventListener('click', () => {
      ipcRenderer.send('open_editor');
    });

    // check for new version
    fetch('https://api.github.com/repos/hainguyents13/mechvibes/releases/latest')
      .then(res => res.json())
      .then(json => {
        if (json.tag_name > app_current_version) {
          new_version.innerHTML = json.tag_name;
          update_available.classList.remove('hidden');
        }
      });

    // display keycode
    const app_logo = document.getElementById('logo');
    const app_body = document.getElementById('app-body');
    const pack_list = document.getElementById('pack-list');
    const volume_value = document.getElementById('volume-value-display');
    const volume = document.getElementById('volume');

    // a little hack for open link in browser
    Array.from(document.getElementsByClassName('open-in-browser')).forEach(elem => {
      elem.addEventListener('click', e => {
        e.preventDefault();
        shell.openExternal(e.target.href);
      });
    });

    // load all packs
    await loadPacks(app_logo, app_body);

    // get last selected pack
    current_pack = getPack();

    // transform packs to options list
    packsToOptions(packs, pack_list);

    // display volume value
    if (localStorage.getItem(MV_VOL_LSID)) {
      volume.value = localStorage.getItem(MV_VOL_LSID);
    }
    volume_value.innerHTML = volume.value;
    volume.oninput = function(e) {
      volume_value.innerHTML = this.value;
      localStorage.setItem(MV_VOL_LSID, this.value);
    };

    // listen to key press
    iohook.start();

    // if key released, clear current key
    iohook.on('keyup', () => {
      current_key_down = null;
      last_key_pressed = Date.now();
      app_logo.classList.remove('pressed');
    });

    // key pressed, pack current key and play sound
    iohook.on('keydown', ({ keycode }) => {
      // if hold down a key, not repeat the sound
      if (current_key_down != null && current_key_down == keycode) {
        return;
      }

      // display current pressed key
      // app_logo.innerHTML = keycode;
      app_logo.classList.add('pressed');

      // pack current pressed key
      current_key_down = keycode;

      // pack sprite id
      const sound_id = `keycode-${current_key_down}`;

      // get loaded audio object
      // if object valid, pack volume and play sound
      if (current_pack) {
        playSound(sound_id, localStorage.getItem(MV_VOL_LSID));
      }
    });
  });
})(window, document);

// ==================================================
// universal play function
function playSound(sound_id, volume) {
  const play_type = current_pack.key_define_type ? current_pack.key_define_type : 'single';
  const sound = play_type == 'single' ? current_pack.sound : current_pack.sound[sound_id];
  if (!sound) {
    return;
  }
  sound.volume(Number(volume / 100));
  if (play_type == 'single') {
    sound.play(sound_id);
  } else {
    sound.play();
  }
}
