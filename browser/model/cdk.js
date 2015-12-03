'use strict';

let fs = require('fs-extra');
let request = require('request');
let path = require('path');
let unzip = require('unzip');
let ipcRenderer = require('electron').ipcRenderer;

import InstallableItem from './installable-item';

class CDKInstall extends InstallableItem {
  constructor(installerDataSvc, $timeout, cdkUrl, cdkBoxUrl, installFile) {
    super(cdkUrl, installFile);

    this.installerDataSvc = installerDataSvc;
    this.$timeout = $timeout;
    this.cdkBoxUrl = cdkBoxUrl;
    this.boxName = 'rhel-cdk-kubernetes-7.2-6.x86_64.vagrant-virtualbox.box';

    this.cdkDownloadedFile = path.join(this.installerDataSvc.tempDir(), 'cdk.zip');
    this.cdkBoxDownloadedFile = path.join(this.installerDataSvc.tempDir(), this.boxName);
  }

  checkForExistingInstall() {
  }

  downloadInstaller(progress, success, failure) {
    progress.setDesc('Downloading CDK');

    let cdkBoxWriteStream = fs.createWriteStream(this.cdkBoxDownloadedFile);
    let cdkWriteStream = fs.createWriteStream(this.cdkDownloadedFile);
    let downloadSize = 849890979;
    let currentSize = 0;
    let totalDownloads = 1;

    let completion = () => {
      if (--totalDownloads == 0) {
        return success();
      }
    };

    // request
    //   ({
    //     url: this.cdkBoxUrl,
    //     rejectUnauthorized: false
    //   })
    //   .auth(this.installerDataSvc.getUsername(), this.installerDataSvc.getPassword())
    //   .on('error', (err) => {
    //     cdkBoxWriteStream.close();
    //     failure(err);
    //   })
    //   .on('data', (data) => {
    //     currentSize += data.length;
    //     progress.setCurrent(Math.round((currentSize / downloadSize) * 100));
    //     progress.setLabel(progress.current + "%");
    //   })
    //   .on('end', () => {
    //     cdkBoxWriteStream.end();
    //   })
    //   .pipe(cdkBoxWriteStream)
    //   .on('close', () => {
    //     return completion();
    //   });

    request
      ({
        url: this.getDownloadUrl(),
        rejectUnauthorized: false
      })
      .auth(this.installerDataSvc.getUsername(), this.installerDataSvc.getPassword())
      .on('error', (err) => {
        cdkWriteStream.close();
        failure(err);
      })
      .on('data', (data) => {
        currentSize += data.length;
        progress.setCurrent(Math.round((currentSize / downloadSize) * 100));
        progress.setLabel(progress.current + "%");
      })
      .on('end', () => {
        cdkWriteStream.end();
      })
      .pipe(cdkWriteStream)
      .on('close', () => {
        return completion();
      });
  }

  install(progress, success, failure) {
    progress.setDesc('Installing CDK');

    fs.createReadStream(this.cdkDownloadedFile)
      .pipe(unzip.Extract({path: this.installerDataSvc.installDir()}))
      .on('close', () => {
        fs.move(this.cdkBoxDownloadedFile, path.join(this.installerDataSvc.cdkBoxDir(), this.boxName), (err) => {
          ipcRenderer.on('installComplete', (event, arg) => {
            if (arg == 'vagrant') {
              this.postVagrantSetup(progress, success, failure);
            }
          });
        });
      });
  }

  createEnvironment() {
    let env = {};

    //TODO Need to get this info from VagrantInstaller rather than hard code
    env['path'] = path.join(this.installerDataSvc.vagrantDir(), 'bin') + ';' + process.env['path'];
    env['RUBYLIB'] = path.join(this.installerDataSvc.vagrantDir(), 'lib', 'ruby', '2.1.0');
    env['GEM_HOME'] = path.join(this.installerDataSvc.vagrantDir(), 'lib', 'ruby', 'gems');

    return env;
  }

  postVagrantSetup(progress, success, failure) {
    let vagrantInstall = this.installerDataSvc.getInstallable('vagrant');

    if (vagrantInstall !== undefined && vagrantInstall.isInstalled()) {
      // Vagrant is installed, add CDK bits
      let env = this.createEnvironment();
      require('child_process')
        .exec(
          'vagrant plugin install ' +
          path.join(this.installerDataSvc.cdkDir(), 'plugins', 'vagrant-registration-1.0.0.gem'),
          {
            cwd: path.join(this.installerDataSvc.vagrantDir(), 'bin'),
            env: env
          },
          (error, stdout, stderr) => {
            console.log(stdout);
            console.log(stderr);
            if (error !== null) {
              return failure(error);
            }

            require('child_process')
              .exec(
                'vagrant plugin install ' +
                path.join(this.installerDataSvc.cdkDir(), 'plugins', 'vagrant-adbinfo-0.0.5.gem'),
                {
                  cwd: path.join(this.installerDataSvc.vagrantDir(), 'bin'),
                  env: env
                },
                (error, stdout, stderr) => {
                  console.log(stdout);
                  console.log(stderr);
                  if (error !== null) {
                    return failure(error);
                  }

                  require('child_process')
                    .exec(
                      'vagrant box add --name cdk_v2 ' +
                      path.join(this.installerDataSvc.cdkBoxDir(), this.boxName),
                      {
                        cwd: path.join(this.installerDataSvc.vagrantDir(), 'bin'),
                        env: env
                      },
                      (error, stdout, stderr) => {
                        console.log(stdout);
                        console.log(stderr);
                        if (error !== null) {
                          return failure(error);
                        }

                        progress.setComplete("Complete");
                        success();
                      }
                    );
                }
              );
          }
        );
    }
  }
}

export default CDKInstall;
