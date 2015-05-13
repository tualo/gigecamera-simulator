var cv = require('opencv');

exports.Server = Server = function(){

  this.imageWidth = 600;
  this.imageHeight = 600;

  var colorShift = 255 / this.imageHeight

  // some simple sample data
  this.mat = new cv.Matrix(this.imageWidth,this.imageHeight,cv.Constants.CV_8UC1);
  var len = this.imageWidth*this.imageHeight;
  var buf = Buffer(len);
  buf.fill(0);

  for(var i=0;i<len;i++){
    buf[i] = (i%2===1)?230: Math.floor( colorShift * Math.floor(i/this.imageWidth) );
  }
  this.mat.put(buf);
  this.showDisplay = false;
  this.displayWindowTitle = 'Gige Vision Sim';
  this.isRunning = false;
}

Server.prototype.run = function(enabled){
  if (enabled){
    this.timer = setInterval(this.updateMatrix.bind(this),0.1);
  }else{
    clearTimeout(this.timer);
  }
  this.isRunning = enabled;
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
  this.updateDisplay();
}

Server.prototype.updateDisplay = function(){
  if (this.showDisplay){
    this.displayWindow.show(this.mat);
    this.displayWindow.blockingWaitKey(0, 50);
  }
}
