# homebridge-hive

This [HomeBridge](https://github.com/nfarina/homebridge) Plugin adds support for the Hive Active Heating thermostat to be controlled in the Home app in iOS and via Siri.


## Installation

### 1. Install HomeBridge

This is a plugin for HomeBridge. In order to use this, you will need to install HomeBridge. You will need a computer which is always turned on. Personally, I use a [Raspberry Pi](https://www.raspberrypi.org) but this may not be for the faint-hearted. Any Windows machine or Mac will do fine.

1. Install [Node.JS](https://nodejs.org) - whatever version is currently "Recommended for most users" should be fine, but this was developed on 6.9.
2. Install [HomeBridge](https://github.com/nfarina/homebridge) by running the commands provided in their documentation (you don't need to download anything - you're using Node's package manager)
3. Create a config.json file inside your home directory (so on macOS and Linux the path will be `~/.homebridge/config.json`) using the [sample file](https://github.com/nfarina/homebridge/blob/master/config-sample.json) provided by HomeBridge.
4. Start HomeBridge by running the `homebridge` command
5. Add HomeBridge to your iOS device in the Home app using the key provided.

### 2. Install this plugin

Run this command (you don't need to download anything - you're using Node's package manager)

```
npm install -g homebridge-hive
```

### 3. Configure HomeBridge

In your `config.json` file, add this accessory providing the username and password you use to log into https://my.hivehome.com

```
    "accessories": [
        {
            "accessory": "HiveThermostat",
            "name": "Hive Thermostat",
            "username": "you@example.com",
            "password": "123456789"
        }
    ],
```

Then restart homebridge.

## Known Issues

* When changing the mode you will see options for Off, Heat, Cool and Auto even though only Off and Heat are supported (because of course, Hive can only heat, there's no aircon). This is because, as far as I can tell (let me know if I'm wrong) HomeKit doesn't have a way to specify that cooling isn't available. If you choose "Cool" it will do the same as "Off" and if you choose "Auto" it will do the same as "Heat". In both cases, the UI will show a bit strange until it next refreshes its status.
* If you go into the Details in the Home app, you will see an option to change the display to Celsius or Fahrenheit but attempting to change it will immediately change it back because again, Hive doesn't have that option but HomeKit seems to require it.
* If you go into the Details in the Home app, you will see a blank space next to Serial Number. This is because the Hive API doesn't expose this information but again, HomeKit seems to require it.