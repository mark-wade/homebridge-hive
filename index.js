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
	this.mainDataCallbacks = [];
	this.getNewApiKey(function(error){
		if ( error ) {
			this.log("Could not log into Hive");
			this.log(error);
		} else {
			this.log( "API Key: " + this.apiKey );
		}
	}.bind(this));
	this.cachedDataTime = null;
	this.cachedData = null;
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
			url: "http://api.bgchlivehome.co.uk/v5/login",
			formData: {
				'username': this.username,
				'password': this.password,
				'caller': 'WEB'
			}
		},
		function(error, response, body) {	
			var json = JSON.parse(body);
			if ( json.error ) {
				callback( json.error.reason )
			} else {
				this.apiKey = json.ApiSession;
				callback( null );
			}
		}.bind(this));		
	},
	
	/**
	 * Get the main data from Hive's API
	 *
	 * callback( error )
	 */
	getMainData: function(callback) {
		
		/* If we don't have an API key, don't even bother */
		if ( !this.apiKey ) {
			callback( "No API key" );
		}
		
		/* If we have a cache from within 2 seconds, use that */
		if ( this.cachedDataTime && this.cachedDataTime > Date.now() - 1000 ) {
			callback( null, this.cachedData );
			return;
		}
		
		/* If we have already started doing this, just add our callback to the queue to run when we're done */
		if ( this.mainDataCallbacks.length ) {
			this.mainDataCallbacks.push( callback );
			return;
		}
		this.mainDataCallbacks.push( callback );
		
		/* Still here? Okay we're going to make the call... */
		this.log( "Fetching data from Hive API" );		
		request({
			url: "http://api.bgchlivehome.co.uk/v5/users/" + this.username + "/widgets/climate",
			headers: {
				'Cookie': 'ApiSession=' + this.apiKey
			}
		},
		
		/* Once we have it... */
		function(error, response, body) {	
			
			/* Parse the response */		
			this.cachedData = JSON.parse(body);
			this.cachedDataTime = Date.now()
			
			/* Run our callbacks */
			for ( var i = 0; i < this.mainDataCallbacks.length; i++ ) {
				this.mainDataCallbacks[i]( null, this.cachedData );
			}
			this.mainDataCallbacks = [];
			
		}.bind(this));		
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
					this.log( "Current temperature is " + data.currentTemperature );
					callback( error, data.currentTemperature );
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
					var currentHeatingCoolingState = data.active ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF;
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
					var targetHeatingCoolingState = data.mode == 'OFF' ? Characteristic.TargetHeatingCoolingState.OFF : Characteristic.TargetHeatingCoolingState.HEAT
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
						url: "http://api.bgchlivehome.co.uk/v5/users/" + this.username + "/widgets/climate/control",
						headers: {
							'Cookie': 'ApiSession=' + this.apiKey,
							'Content-Type': 'application/x-www-form-urlencoded'
						},
						body: 'control=' + stateForHive
					},
									
					/* Once we have it... */
					function(error, response, body) {	
						this.log( "Set target state to " + stateForHomebridge );
						
						/* If we turned the heating on, our target temperature is going to be wrong, update it */
						if ( data.mode == 'OFF' && stateForHive != 'OFF' ) {
							this.thermostatService.getCharacteristic(Characteristic.TargetTemperature).setValue( data.targetTemperature, function(){
								callback(null);
							}.bind(this) )
						}
						/* Otherwise, we can just callback as normal */
						else {
							callback(null);
						}
						
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
					this.log( "Target temperature is " + data.targetTemperature );
					callback(error,data.targetTemperature);
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
						url: "http://api.bgchlivehome.co.uk/v5/users/" + this.username + "/widgets/climate/targetTemperature",
						headers: {
							'Cookie': 'ApiSession=' + this.apiKey,
							'Content-Type': 'application/x-www-form-urlencoded'
						},
						body: 'temperatureUnit=C&temperature=' + value
					},
					
					/* Once we have it... */
					function(error, response, body) {
						this.log( "Set target temperature to " + value );
						
						/* Does this mean the thermostat will turn on/off? */
						if ( value > data.currentTemperature && !data.active ) {
							this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
								.setValue( Characteristic.CurrentHeatingCoolingState.HEAT, function(){
									callback(null);
								}.bind(this) );
						} else if ( value < data.currentTemperature && data.active ) {
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
