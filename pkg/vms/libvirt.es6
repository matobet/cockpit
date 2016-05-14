/*
 * Provider for Libvirt
 */
import cockpit from 'base1/cockpit';
import $ from 'jquery';
import {
  clearVms,
  updateOrAddVm,
  deleteVm,
  getVm,
  getAllVms,
  delay,
  deleteUnlistedVMs
} from 'vms/actions';
import { spawnScript, spawnProcess } from 'vms/services';
import { toMegaBytes, isEmpty } from 'vms/helpers';

export default {
  name: 'Libvirt',

  /**
   * read VM properties (virsh)
   *
   * @param VM name
   * @returns {Function}
   */
  GET_VM ({ lookupId: name }) {
    console.log(`${this.name}.GET_VM()`);

    return dispatch => {
      if (!isEmpty(name)) {
        return spawnProcess({
          cmd: 'virsh',
          args: ['-r', 'dumpxml', name]
        }).then(domXml => {
//          console.log(`GET_VM() output: ${output}`);
          const xmlDoc = $.parseXML(domXml);

          const domainElem = xmlDoc.getElementsByTagName("domain")[0];
          const osElem = domainElem.getElementsByTagName("os")[0]
          const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0]
          const vcpuElem = domainElem.getElementsByTagName("vcpu")[0]

          const name = domainElem.getElementsByTagName("name")[0].childNodes[0].nodeValue
          const id = domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue
          const osType = osElem.getElementsByTagName("type")[0].childNodes[0].nodeValue

          const currentMemoryUnit = currentMemoryElem.getAttribute("unit")
          const currentMemory = toMegaBytes(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit);

          const vcpus = vcpuElem.childNodes[0].nodeValue;

          dispatch(updateOrAddVm({name, id, osType, currentMemory, vcpus}));
          // TODO: uptime
          // TODO: cpu, mem, disk, network usage statistics

          return spawnProcess({
            cmd: 'virsh',
            args: ['-r', 'dominfo', name]
          });
        }).then(domInfo => {
          const lines = domInfo.match(/[^\r\n]+/g);
          const stateLine = lines.filter( line => {return line.startsWith('State:')});
          const autostartLine = lines.filter( line => {return line.startsWith('Autostart:')});

          const state = isEmpty(stateLine) ? undefined : stateLine.toString().substring('State:'.length).trim();
          const autostart = isEmpty(autostartLine) ? undefined : autostartLine.toString().substring('Autostart:'.length).trim();
          // console.log(`lines: ${lines},\nstateLine: '${stateLine}' -> '${state}', autostartLine: '${autostartLine}' -> '${autostart}'`);

          dispatch(updateOrAddVm({name, state, autostart}));
        });
      }
    };
  },

  /**
   * Initiate read of all VMs
   *
   * @returns {Function}
   */
  GET_ALL_VMS () {
    console.log(`${this.name}.GET_ALL_VMS():`);
    return dispatch => {
      spawnScript({
        script: 'virsh -r list --all | awk \'$1 == "-" || $1+0 > 0 { print $2 }\''
      }).then(output => {
        const vmNames = output.trim().split(/\r?\n/);
        vmNames.forEach((vmName, index) => {
          vmNames[index] = vmName.trim();
        });
        console.log(`GET_ALL_VMS: vmNames: ${JSON.stringify(vmNames)}`);

        // TODO: detect removed machines
        // remove undefined domains
        dispatch(deleteUnlistedVMs(vmNames));

        // read VM details
        return cockpit.all(vmNames.map((name) => dispatch(getVm(name))));
      }).then(() => {
        // keep polling after all VM details have been read
        dispatch(delay(getAllVms()));
      });
    };
  },

  SHUTDOWN_VM ({ name }) {
    console.log(`${this.name}.SHUTDOWN_VM(${name}):`);
    return spawnVirsh('SHUTDOWN_VM', 'shutdown', name);
  },

  FORCEOFF_VM ({ name }) {
    console.log(`${this.name}.FORCEOFF_VM(${name}):`);
    return spawnVirsh('FORCEOFF_VM', 'destroy', name);
  },

  REBOOT_VM ({ name }) {
    console.log(`${this.name}.REBOOT_VM(${name}):`);
    return spawnVirsh('REBOOT_VM', 'reboot', name);
  },

  FORCEREBOOT_VM ({ name }) {
    console.log(`${this.name}.FORCEREBOOT_VM(${name}):`);
    return spawnVirsh('FORCEREBOOT_VM', 'reset', name);
  },

  START_VM ({ name }) {
    console.log(`${this.name}.START_VM(${name}):`);
    return spawnVirsh('START_VM', 'start', name);
  }
}

// TODO: add configurable custom virsh attribs - i.e. connection URI and libvirt user/pwd
function spawnVirsh (method, ...args ) {
  return spawnProcess({
    cmd: 'virsh',
    args
  }).catch((ex, data, output) => {
    console.error(`${method}() exception: '${ex}', data: '${data}', output: '${output}'`);
  });
}