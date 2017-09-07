var Service, Characteristic;
var request = require("request");
module.exports = function(homebridge){
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-hive", "HiveThermostat", HiveThermostat);
};
function HiveThermostat(log, config) {
	this.log = log;
	this.name = config.name;
	this.thermostatService = new Service.Thermostat(this.name);
	this.informationService = new Service.AccessoryInformation();
	this.username = config.username;
	this.password = config.password;
	this.id = config.hasOwnProperty('id') ? config.id : null;
	this.mainDataCallbacks = [];
	this.getNewApiKey(function(error){
		if ( error ) {
			this.log("Could not log into Hive");
			this.log(error);
		} else {
			this.log( "Logged In" );
			this.getMainData(function(){},true);
		}
	}.bind(this));
	this.cachedDataTime = null;
	this.cachedMainData = null;
	this.debug = config.hasOwnProperty('debug') ? config.debug : false;
}

HiveThermostat.prototype = {
	
	identify: function(callback) {
		callback(null);
	},
	
	/* -------------------- */
	/* !Utility Methods		*/
	/* -------------------- */

	/**
	 * Get a new API key
	 */
	getNewApiKey: function(callback) {	
		this.log("Logging into Hive...");	
		request.post({
			url: "https://api-prod.bgchprod.info:443/omnia/auth/sessions",
			headers: {
				'Content-Type': 'application/vnd.alertme.zoo-6.1+json',
				'Accept': 'application/vnd.alertme.zoo-6.1+json',
				'X-Omnia-Client': 'Hive Web Dashboard'
			},
			body: JSON.stringify({
				"sessions": [{
					"username": this.username,
					"password": this.password,
					"caller": "WEB"
				}]
			})
		},
		function(error, response, body) {
			try {
				var json = JSON.parse(body);
				if ( json.error ) {
					callback( json.error.reason )
				} else {
					this.apiKey = json.sessions[0].sessionId;
					callback( null );
				}
			} catch (e) {
				callback( "JSON Parse Error\n" + body );
			}
		}.bind(this));		
	},
	
	/**
	 * Get the main data from Hive's API using a queue to prevent multiple calls
	 *
	 * callback( error )
	 */
	getMainData: function(callback,showIds) {
		
		/* If we don't have an API key, don't even bother */
		if ( !this.apiKey ) {
			callback( "No API key" );
		}
		
		/* If we have a cache from within 2 seconds, use that */
		if ( this.cachedDataTime && this.cachedDataTime > Date.now() - 1000 ) {
			callback( null, this.cachedMainData );
			return;
		}
		
		/* If we have already started doing this, just add our callback to the queue to run when we're done */
		if ( this.mainDataCallbacks.length ) {
			this.mainDataCallbacks.push( callback );
			return;
		}
		this.mainDataCallbacks.push( callback );
		
		/* Still here? Define the sucess handler... */
		var successHandler = function(body){
			/* Parse the response */
			for ( var i = 0; i < body.nodes.length; i++ ) {
				if ( body.nodes[i].nodeType == "http:\/\/alertme.com\/schema\/json\/node.class.thermostat.json#" && body.nodes[i].attributes.temperature && ( !this.id || body.nodes[i].id == this.id ) ) {
					this.cachedMainData = body.nodes[i];
                                        this.log(JSON.stringify(body.nodes[i]);
					if ( showIds ) {
						this.log("Found thermostat " + body.nodes[i].id + ". Current temperature is " + body.nodes[i].attributes.temperature.reportedValue + ", set to " + body.nodes[i].attributes.targetHeatTemperature.reportedValue );
					}
				}
			}
			this.cachedDataTime = Date.now()
			
			/* Run our callbacks */
			for ( var i = 0; i < this.mainDataCallbacks.length; i++ ) {
				this.mainDataCallbacks[i]( null, this.cachedMainData );
			}
			this.mainDataCallbacks = [];
		}.bind(this);
		/* ...and make the call */
		this._getMainData(function(error, response, body) {	
			if ( this.debug ) {
				this.log( response );
			}
			body = JSON.parse(body);
			if ( body.errors ) {
				this.getNewApiKey(function(error){
					this._getMainData(function(error, response, body) {
						body = JSON.parse(body);
						if ( body.errors ) {
							this.log( body.errors );
						} else {
							successHandler(body);
						}
					}.bind(this));
				}.bind(this));
				return;
			}
			successHandler(body);
			
		}.bind(this));		
	},
	
	/**
	 * Get the main data from Hive's API
	 *
	 * callback( error )
	 */
	_getMainData: function(callback) {
		this.log( "Fetching data from Hive API" );		
		request({
			url: "https://api-prod.bgchprod.info:443/omnia/nodes",
			headers: {
				'Content-Type': 'application/vnd.alertme.zoo-6.1+json',
				'Accept': 'application/vnd.alertme.zoo-6.1+json',
				'X-Omnia-Client': 'Hive Web Dashboard',
				'X-Omnia-Access-Token': this.apiKey
			}
		}, callback );
	},
	
	/* -------------------- */
	/* !Services */
	/* -------------------- */

	getServices: function() {
		
		/* -------------------- */
		/* !Thermostat			*/
		/* -------------------- */

		/**
		 * Get Current Temperature (Read Only)
		 */
		this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', function(callback) {
				this.getMainData(function(error,data){
					this.log( "Current temperature is " + data.attributes.temperature.reportedValue );
					callback( error, data.attributes.temperature.reportedValue );
				}.bind(this));
			}.bind(this))
		;
		
		/**
		 * Get Current Heating/Cooling State (Read Only - i.e. what the system is doing right now)
		 *
		 * Characteristic.CurrentHeatingCoolingState.OFF = Not Heating (either because it is turned off or has reached the desired temprature)
		 * Characteristic.CurrentHeatingCoolingState.HEAT = Heating
		 *
		 * Cannot be Auto because we want to know what it's doing *right now*
		 *
		 */
		this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.on('get', function(callback) {
				this.getMainData(function(error,data){
					
					if ( data.attributes.stateHeatingRelay.reportedValue == 'OFF' ) {
						var currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
					} else {
						var currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.HEAT;
					}
					
					this.log( "Current state is " + currentHeatingCoolingState );
					callback( error, currentHeatingCoolingState );
					
				}.bind(this));
			}.bind(this))
		;
		
		/**
		 * Target Heating/Cooling State (Can be read and set - is what the system is doing now or we have told it we want to do)
		 *
		 * Characteristic.TargetHeatingCoolingState.OFF = Off / Frost Protect
		 * Characteristic.TargetHeatingCoolingState.HEAT = Heat when below target temperature
		 *
		 */
		this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			
			/**
			 * Get
			 */
			.on('get', function(callback) {
				this.getMainData(function(error,data){
					
					if ( data.attributes.activeHeatCoolMode.reportedValue == 'OFF' || data.attributes.targetHeatTemperature.reportedValue == 1 ) {
						var targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
					} else {
						var targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.HEAT;
					}
					
					this.log( "Target state is " + targetHeatingCoolingState );
					callback( error, targetHeatingCoolingState );
					
				}.bind(this));
			}.bind(this))
						
			/**
			 * Set
			 */
			.on('set', function(value, callback) {
								
				/* We need to know our current state so we know what we're changing... */
				this.getMainData(function(error,data){
									
					/* Work out what we need to set */			
					var stateForHive = null;
					var stateForHomebridge = null;
					switch ( value ) {
						case Characteristic.TargetHeatingCoolingState.OFF:
						case Characteristic.TargetHeatingCoolingState.COOL:
							stateForHive = 'OFF';
							stateForHomebridge = Characteristic.TargetHeatingCoolingState.OFF;
							break;
						case Characteristic.TargetHeatingCoolingState.HEAT:
						case Characteristic.TargetHeatingCoolingState.AUTO:
							stateForHive = 'MANUAL';
							stateForHomebridge = Characteristic.TargetHeatingCoolingState.HEAT;
							break;
					}
									
					/* Set it */
					request.put({
						url: "https://api-prod.bgchprod.info:443/omnia/nodes/" + data.id,
						headers: {
							'Content-Type': 'application/vnd.alertme.zoo-6.1+json',
							'Accept': 'application/vnd.alertme.zoo-6.1+json',
							'X-Omnia-Client': 'Hive Web Dashboard',
							'X-Omnia-Access-Token': this.apiKey
						},
						body: JSON.stringify({
							"nodes": [{
						        "attributes": {
						            "activeHeatCoolMode": {
						                "targetValue": stateForHive
						            }
						        }
						    }]
						})
					},
									
					/* Once we have it... */
					function(error, response, body) {	
						this.log( "Set target state to " + stateForHomebridge );
						callback(null);
					}.bind(this));
					
				}.bind(this))
				
				
			}.bind(this))
			
		;
		
		/**
		 * Target Temperature (Can be read and set)
		 */
		this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
			
			/**
			 * Get
			 */
			.on('get', function(callback) {
				this.getMainData(function(error,data){
					var targetTemperature = data.attributes.targetHeatTemperature.reportedValue;
					if ( targetTemperature == 1 ) {
						targetTemperature = data.attributes.frostProtectTemperature.reportedValue;
					}
					this.log( "Target temperature is " + targetTemperature );
					callback(error,targetTemperature);
				}.bind(this));
			}.bind(this))
			
			/**
			 * Min/Max Values for setting
			 */
			.setProps({
				minValue: 5.0,
				maxValue: 32.0,
				minStep: 0.5
			})
			
			/**
			 * Set
			 */
			.on('set', function(value, callback) {
				
				/* We need to know our current state so we know what we're changing... */
				this.getMainData(function(error,data){
					
					/* Set it */			
					request.put({
						url: "https://api-prod.bgchprod.info:443/omnia/nodes/" + data.id,
						headers: {
							'Content-Type': 'application/vnd.alertme.zoo-6.1+json',
							'Accept': 'application/vnd.alertme.zoo-6.1+json',
							'X-Omnia-Client': 'Hive Web Dashboard',
							'X-Omnia-Access-Token': this.apiKey
						},
						body: JSON.stringify({
							"nodes": [{
						        "attributes": {
						            "targetHeatTemperature": {
						                "targetValue": value
						            }
						        }
						    }]
						})
					},
					
					/* Once we have it... */
					function(error, response, body) {
						this.log( "Set target temperature to " + value );
						
						/* Does this mean the thermostat will turn on/off? */
						if ( value > data.attributes.temperature.reportedValue && data.attributes.stateHeatingRelay.reportedValue == 'OFF' ) {
							this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
								.setValue( Characteristic.CurrentHeatingCoolingState.HEAT, function(){
									callback(null);
								}.bind(this) );
						} else if ( value < data.attributes.temperature.reportedValue && data.attributes.stateHeatingRelay.reportedValue == 'HEAT' ) {
							this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
								.setValue( Characteristic.CurrentHeatingCoolingState.OFF, function(){
									callback(null);
								}.bind(this) );
						} else {						
							callback(null);
						}
					}.bind(this));
					
				}.bind(this));
				
			}.bind(this))
			
		;
		
		/**
		 * Hardware display units (in theory can be read and set but we don't actually allow this)
		 */
		this.thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			
			/**
			 * Get
			 */
			.on('get', function(callback) {
				callback( null, Characteristic.TemperatureDisplayUnits.CELSIUS );
			}.bind(this))

			/**
			 * Set
			 */
			.on('set', function(value, callback) {
				callback("Cannot change display units");
			}.bind(this))
		;		
				
		/* --------------------- */
		/* !AccessoryInformation */
		/* --------------------- */
		
		this.informationService
			.setCharacteristic(Characteristic.Manufacturer, "British Gas")
			.setCharacteristic(Characteristic.Model, "Hive Active Heating")
			.setCharacteristic(Characteristic.SerialNumber, " ");
		
		
		
		
		return [this.thermostatService,this.informationService];
	}
};
