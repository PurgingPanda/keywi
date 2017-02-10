function LocalSecureStorage() {
    let self = this;
    return new Promise(function(resolve, reject) {
        self._unlockStorage().then(function() {
           resolve(self);
        }).catch(function(err) {
           console.log(err);
           reject(self);
        });
    });
}

LocalSecureStorage.prototype = Object.create(SecureStorage.prototype);
LocalSecureStorage.prototype.constructor = LocalSecureStorage;
LocalSecureStorage.prototype._prefix = "local_secure_storage__";
LocalSecureStorage.prototype._dummyValueKey = "encryption_key_test";

LocalSecureStorage.prototype._encryptionkey = null;


LocalSecureStorage.prototype.ready = function() {
    return LocalSecureStorage.prototype._encryptionkey !== null;
};

/**
 * @brief Checks if the SecureStorage already has an encryption key.
 * @returns {Promise}
 * @private
 */
LocalSecureStorage.prototype._hasEncryptionKey = function() {
    /**
     * We store some dummy data in the LocalSecureStorage to make the user already provided an encryption key.
     */
    let self = this;
    return new Promise(function(resolve, reject) {
        self.has(LocalSecureStorage.prototype._dummyValueKey).then(function () {
           resolve();
        }).catch(function (error) {
           reject(error);
        });
    });
};

/**
 * @brief Asks the user for a new password to the Secure storage.
 *  - will derive a key of this
 *  - save the dummy value
 *  - save the new encryption key in LocalSecureStorage.prototype._encryptionKey
 * @returns {Promise}
 * @private
 */
LocalSecureStorage.prototype._setupNewPassword = function() {
    return new Promise(function(resolve, reject) {
        LocalSecureStorage.prompts.setupNewPassword()
            .then(function(userKey) {
                Crypto.deriveKey(userKey, true).then(function (encryptionKey) {
                    var verifiers = Crypto.generateVerifier(encryptionKey);

                    var data = {};
                    data[LocalSecureStorage.prototype._prefix + LocalSecureStorage.prototype._dummyValueKey] = {
                        nonce: verifiers[0],
                        verifier: verifiers[1]
                    };

                    browser.storage.local.set(data);

                    LocalSecureStorage.prototype._encryptionkey = encryptionKey;
                    resolve();
                }).catch(function(err){
                    console.error(err);
                    reject(err);
                });
            }).catch(function(err){
                console.error(err);
                reject(err);
            });
    });
};

LocalSecureStorage.prototype._unlockExistingPassword = function() {
    return new Promise(function(resolve, reject) {
        LocalSecureStorage.prompts.unlock(function(userKey, accept, reject) {
            // This function works as a verifier which can be called by the unlock() prompt to verify the correctness of the key
            Crypto.deriveKey(userKey).then(function (encryptionKey) {
                browser.storage.local.get(LocalSecureStorage.prototype._prefix + LocalSecureStorage.prototype._dummyValueKey).then(function (data) {
                    var actualData = data[LocalSecureStorage.prototype._prefix + LocalSecureStorage.prototype._dummyValueKey];
                    var iv = actualData.nonce;
                    var verifier = actualData.verifier;

                    /**
                     * First verify that the provided key to the LocalSecureStorage is correct.
                     */
                    var checkIvStr = Crypto.decryptAsString(verifier, encryptionKey, iv);

                    if (checkIvStr !== iv) {
                        console.log("Error decrypting: key wrong!");
                        reject("Wrong  key provided by user!");
                    } else {
                        accept(encryptionKey);
                    }
                });
            });
        }).then(function(encryptionKey) {
            // the prompts.unlock will resolve the Promise when it's done cleaning up the prompt
            LocalSecureStorage.prototype._encryptionkey = encryptionKey;
            resolve();
        }).catch(function(err){
            reject(err);
        });
    });
};

LocalSecureStorage.prototype._unlockStorage = function() {
    let self = this;
    return new Promise(function (resolve, reject) {
        // first check if there is already an encryption key
        if (LocalSecureStorage.prototype._encryptionkey !== null) {
            resolve();
        } else {
            // check if the user has ever provided an encryption key
            self._hasEncryptionKey()
                .then(function(){
                    // we have an encryption key, ask the user to input this, and verify that this is the correct key and store it for later user
                    self._unlockExistingPassword().then(function() {
                        resolve();
                    }).catch(function(err){
                        console.error(err);
                        reject(err);
                    });
                })
                .catch(function (error) {
                    // we don't have an encryption key, create one, and store dummy data with it
                    self._setupNewPassword().then(function() {
                       resolve();
                    }).catch(function(err){
                        console.error(err);
                        reject(err);
                    });
                });
        }
    });
};

LocalSecureStorage.prototype.has = function(key) {
    return new Promise(function (resolve, reject) {
        browser.storage.local.get(LocalSecureStorage.prototype._prefix + key, function (data) {
            if (Object.keys(data).length === 0) {
                reject("No such key!");
            } else {
                resolve();
            }
        });
    });
};

LocalSecureStorage.prototype.set = function(key, value) {
    let self = this;
    return new Promise(function (resolve, reject) {
        self._unlockStorage().then(function() {
            SecureStorage.prototype._setCache(key, value);
            var verifiers = Crypto.generateVerifier(LocalSecureStorage.prototype._encryptionkey);

            var data = {};
            data[LocalSecureStorage.prototype._prefix + key] = {
                data: Crypto.encrypt(value, LocalSecureStorage.prototype._encryptionkey, verifiers[0]),
                nonce: verifiers[0],
                verifier: verifiers[1]
            };

            browser.storage.local.set(data);

            resolve();
        }).catch(function(err) {
            console.error(err);
            reject(err);
        });
    });
};

LocalSecureStorage.prototype.get = function (key) {
    let self = this;
    return new Promise(function (resolve, reject) {
        if (SecureStorage.prototype._hasCache(key)) {
            resolve(SecureStorage.prototype._getCache(key));
        } else {
            self._unlockStorage().then(function() {
                browser.storage.local.get(LocalSecureStorage.prototype._prefix + key).then(function (data) {
                    if (Object.keys(data).length === 0) {
                        reject("Not found (" + key + ")");
                    } else {
                        let decryptedDataStr = self._decrypt(data[LocalSecureStorage.prototype._prefix + key]);
                        resolve(decryptedDataStr);
                    }
                });

            }).catch(function (err) {
                console.error(err);
                reject(err);
            });
        }
    });
};

/**
 * @brief Decrypts and verifies a data object using the LocalSecureStorage.prototype._encryptionKey as key.
 * @param data, object must have the data, nonce and verifier values. Data is the encrypted data,
 * nonce is a one-time used random value and verifier is the encrypted nonce.
 */
LocalSecureStorage.prototype._decrypt = function (data) {
    let iv = data.nonce;
    let verifier = data.verifier;

    /**
     * First verify that the data is encrypted with the key stored in this._encryptionKey.
     */
    let checkIvStr = Crypto.decryptAsString(verifier, LocalSecureStorage.prototype._encryptionkey, iv);

    if (checkIvStr !== iv) {
        console.log("Error decrypting: key wrong!");
        throw "Error decrypting: key wrong!";
        // return null;
    }

    /**
     * Decrypt the data.
     */
    let decryptedDataStr = Crypto.decryptAsString(data.data, LocalSecureStorage.prototype._encryptionkey, iv);

    return decryptedDataStr;
};

LocalSecureStorage.prototype.delete = function (key) {
    browser.storage.local.remove(LocalSecureStorage.prototype._prefix + key);
};

/**
 * @brief re-encrypts the SecureStorage by asking the user for a new password.
 *  - This will automatically generate a new salt.
 *  - This can be used when you have changed the e.g. hashing rounds count
 */
LocalSecureStorage.prototype.reencrypt = function() {
    var self = this;
    browser.storage.local.get().then(function(data) {
        // first fetch all old data and decrypt it
        let dataToSave = {};

        let prefixLength = LocalSecureStorage.prototype._prefix.length;

        for (const key of Object.keys(data)) {
            if (key.substr(0, prefixLength) === LocalSecureStorage.prototype._prefix) {
                // only re-encrypt encrypted keys
                // and do not ree-ncrypt the dummy value
                let userKey = key.substr(prefixLength, key.length - prefixLength);
                if (userKey !== LocalSecureStorage.prototype._dummyValueKey) {
                    dataToSave[userKey] = self._decrypt(data[key]);
                    self.delete(userKey); // remove from the Secure Storage
                }
            }
        }

        self._setupNewPassword().then(function(newEncryptionKey) {
            // ask the user to enter a new password and setup the database to use it
            for (const ikey of Object.keys(dataToSave)) {
                let idata = dataToSave[ikey];
                self.set(ikey, idata); // will automatically use the new key
            }
        });

    });
};

