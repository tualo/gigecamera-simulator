var cv = require('opencv');
var os = require('os');
var fs = require('fs');
var path = require('path');
var NanoTimer = require('nanotimer');
var dgram = require("dgram");
var gigecamera = require("gigecamera");

var CONTROL_PORT = 3956;
var consts = gigecamera.Constants;
var Constants = consts.CONSTANTS;
var Commands = gigecamera.Commands;

exports.Server = Server = function(address){
  if (typeof address==='undefined'){
    address = '0.0.0.0';
  }

  this.imageWidth = 1024;
  this.imageHeight = 100;

  var colorShift = 255 / this.imageHeight

  // some simple sample data
  this.mat = new cv.Matrix(this.imageHeight,this.imageWidth,cv.Constants.CV_8UC1);
  var len = this.imageWidth*this.imageHeight;
  var buf = Buffer(len);
  buf.fill(0);

  for(var i=0;i<len;i++){
    buf[i] = (i%2===1)?255: Math.floor( colorShift * Math.floor(i/this.imageWidth) );
  }
  this.mat.put(buf);
  this.showDisplay = false;
  this.displayWindowTitle = 'Gige Vision Sim';
  this.isRunning = false;
  this.block_id=1;

  this.register = new Buffer(1024*1024*68); // 68MB Register
  this.register.fill(0);

  this.xml = fs.readFileSync(path.join(__dirname,'..','data','camera.xml'));


  var ifaces = os.networkInterfaces();
  for(var name in ifaces){
    for(var i=0;i<ifaces[name].length;i++){
      if ( (ifaces[name][i].internal===false) && (ifaces[name][i].family==='IPv4') ){
        if (address==='0.0.0.0'){
          this.iface = ifaces[name][i];
          break;
        }else{
          if (address===ifaces[name][i].address){
            this.iface = ifaces[name][i];
            break;
          }
        }
      }
    }
  }


  var REGISTER = consts.REGISTER;



  REGISTER['Version'].value =  0x0100;

  REGISTER['Device Mode'].value = new Buffer(2);
  REGISTER['Device Mode'].value.fill(0);

  REGISTER['Device Mode'].value.setBit(0,true);
  REGISTER['Device Mode'].value.setBit(1,true);
  REGISTER['Device Mode'].value.writeUIntBE(1,1,1);


  REGISTER['Device MAC address – Low (Network interface #0)'].value = new Buffer(4);
  REGISTER['Device MAC address – Low (Network interface #0)'].value.fill(0);

  REGISTER['Device MAC address – High (Network interface #0)'].value = new Buffer(4);
  REGISTER['Device MAC address – High (Network interface #0)'].value.fill(0);
  parts = this.iface.mac.split(':');
  for(var i=0;i<2;i++){
    REGISTER['Device MAC address – Low (Network interface #0)'].value[i+2] = Number('0x'+parts[i]);
  }
  for(var i=2;i<6;i++){
    REGISTER['Device MAC address – High (Network interface #0)'].value[i] = Number('0x'+parts[i]);
  }




  REGISTER['Current IP address (Network interface #0)'].value = new Buffer(4);
  REGISTER['Current IP address (Network interface #0)'].value.fill(0);
  parts = this.iface.address.split('.');
  for(var i=0;i<4;i++){
    REGISTER['Current IP address (Network interface #0)'].value[i] = parts[i]*1;
  }

  REGISTER['Current subnet mask (Network interface #0)'].value = new Buffer(4);
  REGISTER['Current subnet mask (Network interface #0)'].value.fill(0);
  parts = this.iface.netmask.split('.');
  for(var i=0;i<4;i++){
    REGISTER['Current subnet mask (Network interface #0)'].value[i] = parts[i]*1;
  }

  REGISTER['Current default Gateway (Network interface #0)'].value = new Buffer(4);
  REGISTER['Current default Gateway (Network interface #0)'].value.fill(0);



  REGISTER['Manufacturer name'].value = 'tualo solutions GmbH';
  REGISTER['Model name'].value = 'gige sim';
  REGISTER['Device version'].value = 'gige sim  v1.0';
  REGISTER['Manufacturer specific information'].value = 'gige sim  v1.0';
  REGISTER['Serial number'].value = '0123456789';
  REGISTER['User-defined name'].value = 'nothing to say';


  var cnf_address = '1C400';
  REGISTER['First choice of URL for XML device description file'].value = 'Local:camera.xml;'+cnf_address+';'+Number(this.xml.length).toString('16')+'';

  this.setRegister( Number('0x'+cnf_address),this.xml);

  REGISTER['Second choice of URL for XML device description file'].value = 'http://tualo.de';
  REGISTER['Number of network interfaces'].value=1;


  var buffer = new Buffer(4);
  buffer.fill(0);
  buffer.setBit(0,true);
  buffer.setBit(1,true);
  buffer.setBit(4,true);
  buffer.setBit(29,true);
  buffer.setBit(30,true);
  REGISTER['GVCP Capability'].value = buffer;


  for(var registerName in REGISTER){
    if (REGISTER[registerName].value !== 'undefined'){
      this.setRegister( Number(REGISTER[registerName].address), REGISTER[registerName].value);
    }
  }

  this.setRegister(0x0A14,REGISTER['Current IP address (Network interface #0)'].value); //set IP


  this.setRegister( 0x0D04, 1500) // mtu / packed size
  this.setRegister( 0x30224, 1) // image height


  this.setRegister( 0x40004, 0) // AcquisitionMode
  this.setRegister( 0x40024, 0) // AcquisitionStart
  this.setRegister( 0x40044, 0) // AcquisitionStop
  this.setRegister( 0x60004, 0) // invalidator

  this.setRegister( 0x40448, 1) // exposure scaling
  this.setRegister( 0x40440, 1) // exposure using 1000

  this.setRegister( 0x40424, 0) // exposure mode, off


  this.setRegister( 0x40464, 1000) // exposure time raw
  this.setRegister( 0x40468, 10)  // exposure time min
  this.setRegister( 0x4046c, 100000)  // exposure time max
  this.setRegister( 0x40470, 10)  // exposure time inc

  // available exposure modes
  this.setRegister( 0x4042c, this.readRegister(0x4042c,4).setBit(0,true) ); // off available
  this.setRegister( 0x4042c, this.readRegister(0x4042c,4).setBit(1,true) ); // once available
  this.setRegister( 0x4042c, this.readRegister(0x4042c,4).setBit(2,false) ); // continuous available

  // exposure mode available
  this.setRegister( 0x40420, this.readRegister(0x40420,4).setBit(1,true) );

  // exposure mode available
  this.setRegister( 0x40460, this.readRegister(0x40460,4).setBit(0,true) ); // ExposureTimeRaw implemented
  this.setRegister( 0x40460, this.readRegister(0x40460,4).setBit(1,true) ); // ExposureTimeRaw available
  this.setRegister( 0x40460, this.readRegister(0x40460,4).setBit(3,false) ); // ExposureTimeRaw locked

}



Server.prototype.readRegister = function(address,length){
  if ( (typeof address==='string') && (typeof length==='undefined') ){
    if (typeof consts.REGISTER[address]==='object'){
      return this.readRegister(consts.REGISTER[address].address,consts.REGISTER[address].length);
    }
  }else{
    if (typeof length==='undefined'){
      length = 4;
    }
    return this.register.slice(Number(address),Number(address)+length);
  }
}

Server.prototype.setRegister = function(address,data){

  var buffer;
  if (typeof data==='number'){
    buffer = new Buffer(4);
    buffer.writeUIntBE(data,0,4);
  }else if (typeof data==='string'){

    buffer = new Buffer(data.length);
    for(var i=0; i<data.length;i++){
      buffer[i] = data.charCodeAt(i);
    }
  }else if (typeof data==='object'){
    if (data instanceof Buffer){
      buffer = data;
    }
  }

  if (typeof buffer==='object'){
    buffer.copy(this.register,address);
  }
}

Server.prototype.run = function(enabled){
  var me = this;
  if (enabled){
    this.timer = new NanoTimer();
    //console.time('time');

    this.timer.setInterval(this.updateMatrix.bind(this), '', '10u');


    me.client = dgram.createSocket("udp4");
    me.client.on('close', function(){ console.log('client closed'); } );
    me.client.on('error', function(e){ console.error('client error',e); } );
    me.client.on("listening", function () { });
    me.client.bind();



    me.server = dgram.createSocket("udp4");
    me.server.on("error", function (err) {
      console.error("server error:\n" + err.stack);
      me.server.close();
      process.exit();
    });

    me.server.on("message", me.incommingMessage.bind(me));

    me.server.on("listening", function () {
      var address = me.server.address();
      var ifaces = os.networkInterfaces();
      for(var name in ifaces){
        for(var i=0;i<ifaces[name].length;i++){
          if ( (ifaces[name][i].internal===false) && (ifaces[name][i].family==='IPv4') ){
            if (address.address==='0.0.0.0'){
              me.iface = ifaces[name][i];
              break;
            }else{
              if (address.address===ifaces[name][i].address){
                me.iface = ifaces[name][i];
                break;
              }
            }
          }
        }
      }
      me.port = address.port;
    });
    me.server.bind(CONTROL_PORT);

  }else{
    this.timer.clearInterval();
    this.server.close();
  }
  this.isRunning = enabled;
}

Server.prototype.incommingMessage = function(msg,remote){

  var me=this,ack = null;

  if( me.timeout !== 'undefined' ){
    clearTimeout(me.timeout);
  }
  me.timeout = setTimeout(function(){
    me.setRegister( 0x40024,0);
    console.log('timeout');
  },3000);

  if (msg[0]===0x42){
    var flags = msg[1];
    var parts = '';
    var command = msg.readUIntBE(2,2);
    var length = msg.readUIntBE(4,2);
    var req_id = msg.readUIntBE(6,2);

    if (command === Constants.DISCOVERY_CMD){

      ack = new gigecamera.Messages.DISCOVERY_ACK.DISCOVERY_ACK();
      ack.status = gigecamera.Constants.STATUS.GEV_STATUS_SUCCESS;
      ack.command = command+1;
      ack.ack_id = req_id;

      ack.version_major = 3;
      ack.version_minor = 1;

      ack.device_mode =  1;
      ack.reserved_1 = 0;

      ack.mac_address = new Buffer([0,0,0,0,0,0]);
      parts = me.iface.mac.split(':');
      for(var i=0;i<6;i++){
        ack.mac_address[i] = Number('0x'+parts[i]);
      }

      ack.ip_config_options = 0;
      ack.ip_config_current = 0;

      ack.reserved_2 = 0;
      ack.reserved_3 = 0;
      ack.reserved_4 = 0;

      ack.current_ip_buf = new Buffer([0,0,0,0]);
      parts = me.iface.address.split('.');
      for(var i=0;i<4;i++){
        ack.current_ip_buf[i] = parts[i]*1;
      }

      ack.reserved_5 = 0;
      ack.reserved_6 = 0;
      ack.reserved_7 = 0;
      ack.current_subnet_mask_buf = new Buffer([0,0,0,0]);
      parts = me.iface.netmask.split('.');
      for(var i=0;i<4;i++){
        ack.current_subnet_mask_buf[i] = parts[i]*1;
      }

      ack.reserved_8 = 0;
      ack.reserved_9 = 0;
      ack.reserved_10 = 0;
      ack.current_gateway_buf = new Buffer([0,0,0,0]);

      ack.manufacturer_name = me.readRegister('Manufacturer name').readString();// "tualo solutions GmbH";
      ack.model_name = me.readRegister('Model name').readString();
      ack.device_version = me.readRegister('Device version').readString();
      ack.manufacturer_info = me.readRegister('Manufacturer specific information').readString();//"tualo solutions GmbH"+" | "+"sim cam 1.0";
      ack.serial_number = me.readRegister('Serial number').readString();
      ack.user_defined_name = me.readRegister('User-defined name').readString();

      var message = ack.toBuffer();
      me.server.send(message, 0, message.length, remote.port, remote.address, function(err, bytes) {
        if (err){
          console.error(err);
        }else{

        }
      });

    }else if (command === Constants.READREG_CMD){
      var cmd = new Commands.READREG.READREG();
      cmd.parse(msg);

      ack = new gigecamera.Messages.READREG_ACK.READREG_ACK();
      ack.status = gigecamera.Constants.STATUS.GEV_STATUS_SUCCESS;
      ack.command = command+1;
      ack.ack_id = req_id;

      for(var registerIndex=0;registerIndex < cmd.registerIndex;registerIndex++){

        ack.data[ cmd.registers[registerIndex] ] = me.readRegister(cmd.registers[registerIndex]);
      }

      var message = ack.toBuffer();
      me.server.send(message, 0, message.length, remote.port, remote.address, function(err, bytes) { if (err){ console.error(err); }else{
      } });

    }else if (command === Constants.READMEM_CMD){
      var cmd = new Commands.READMEM.READMEM();
      cmd.parse(msg);

      ack = new gigecamera.Messages.READMEM_ACK.READMEM_ACK();
      ack.status = gigecamera.Constants.STATUS.GEV_STATUS_SUCCESS;
      ack.command = command+1;
      ack.ack_id = req_id;
      ack.address = new Buffer(4);

      ack.address.writeUIntBE(cmd.address,0,4);

      ack.data  =me.readRegister(cmd.address,cmd.count);

      var message = ack.toBuffer();
      me.server.send(message, 0, message.length, remote.port, remote.address, function(err, bytes) { if (err){ console.error(err); }else{ } });

    }else if (command === Constants.WRITEREG_CMD){
      var cmd = new Commands.WRITEREG.WRITEREG();
      cmd.parse(msg);
      for(var i = 0; i<cmd.registers.length;i++){
        if (0x40024===cmd.registers[i].address){
          console.log('start!!!!');
        }
        me.setRegister(cmd.registers[i].address,cmd.registers[i].data);
      }
      ack = new gigecamera.Messages.WRITEREG_ACK.WRITEREG_ACK();
      ack.status = gigecamera.Constants.STATUS.GEV_STATUS_SUCCESS;
      ack.command = command+1;
      ack.ack_id = req_id;
      ack.reseverd = 0;
      ack.index = cmd.registers.length;

      var message = ack.toBuffer();
      me.server.send(message, 0, message.length, remote.port, remote.address, function(err, bytes) { if (err){ console.error(err); }else{ } });


    }else if (command === Constants.WRITEMEM_CMD){
      console.error('WRITEMEM_CMD missing implementation');
      process.exit();
    }
  }
}

Server.prototype.display = function(enabled){
  if (!enabled && this.showDisplay){
    if (typeof this.displayWindow==='object'){
      this.displayWindow.destroy();
    }
  }else{
    this.displayWindow = new cv.NamedWindow(this.displayWindowTitle, 0);
  }
  this.showDisplay = enabled;
}

Server.prototype.updateMatrix = function(){
  var buffer = this.mat.getData();
  var lines = 2;
  var line = buffer.slice(0,this.imageWidth*lines);
  var res = buffer.slice(this.imageWidth*lines);
  res.copy(buffer,0);
  line.copy(buffer,res.length);

  this.mat.put(buffer);

  if (this.readRegister( 0x40024,4).readUIntBE(0,4)===1){


    var options = {};

    options.packetSizeBuffer = this.readRegister(0x0D04,4);
    options.packetSize = options.packetSizeBuffer.readUIntBE(2,2);
    options.port = this.readRegister( 0x0D00,4).readUIntBE(0,4);
    options.ipBuffer = this.readRegister( 0x0D18,4);
    options.ip = options.ipBuffer[0]+'.'+options.ipBuffer[1]+'.'+options.ipBuffer[2]+'.'+options.ipBuffer[3];
    options.height = this.readRegister(0x30224,4).readUIntBE(0,4);
    options.exposure  = this.readRegister(0x40464,4).readUIntBE(0,4);
    options.block_id = this.block_id++;
    options.buffer = buffer.slice(0,this.imageWidth*options.height);

    this.sendingImage(options);

  }

//  console.timeEnd('time');
  this.updateDisplay();
}

Server.prototype.sendingImage = function(options){
  var me = this,message,ack;
  if (typeof options.offset === 'undefined'){
    options.offset = 0;
    // leader needed;
    ack = new gigecamera.Messages.DATA_LEADER.DATA_LEADER();
    ack.payload_type = 1;
    ack.setNameString();
    ack.block_id = options.block_id;
    ack.timestamp_high=0;
    ack.timestamp_low=0;
    ack.pixel_format=1;
    ack.size_x=me.imageWidth;
    ack.size_y=options.height;
    ack.offset_x=0;
    ack.offset_y=0;
    ack.padding_x=0;
    ack.padding_y=0;

    options.packet_id=0;

  }else if ( options.offset < options.buffer.length){
    // payload
    ack = new gigecamera.Messages.DATA_PAYLOAD.DATA_PAYLOAD();
    ack.block_id = options.block_id;
    ack.packet_id = options.packet_id++;
    ack.payload_type = 1;
    ack.payload = options.buffer.slice(options.offset,options.offset+options.packetSize);

  }else{
    // trailer needed;
    ack = new gigecamera.Messages.DATA_TRAILER.DATA_TRAILER();
    ack.block_id = options.block_id;
    ack.payload_type = 1;
    ack.setNameString();
    ack.size_y = options.height;
  }
  message = ack.toBuffer();
  me.client.send(message, 0, message.length, options.port, options.ip, function(err, bytes) {
    if (err){
      console.error(err);
    }else{
      switch(ack.format){
        case 'DATA_LEADER':
          me.sendingImage(options);
        break;
        case 'DATA_PAYLOAD':
          options.offset += ack.payload.length;
          me.sendingImage(options);
        break;
        case 'DATA_TRAILER':
        break;
      }

    }
  });
}

Server.prototype.updateDisplay = function(){
  if (this.showDisplay){
    this.displayWindow.show(this.mat);
    this.displayWindow.blockingWaitKey(0, 50);
  }
}
