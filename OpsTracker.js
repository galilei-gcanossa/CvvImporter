class OpsTracker {
  static track(operationId){
    return new Operation_(operationId);
  }
}

class Operation_ {
  constructor(operationId){
    this.operationId = operationId;

    this.loadStatus();
    this.autoCommit = false;
  }

  log(event){
    this.status.logs.push({...event, datetime:new Date().getTime()});
  }

  logInfo(message, args = undefined){
    this.log({type:'info', text: message, args: args});

    if(this.autoCommit)
      this.commitStatus();
  }

  logWarn(message, args = undefined){
    this.log({type:'warn', text: message, args: args});

    if(this.autoCommit)
      this.commitStatus();
  }

  logError(message, args = undefined){
    this.log({type:'error', text: message, args: args});

    if(this.autoCommit)
      this.commitStatus();
  }

  addSteps(count){
    this.status.progress.total+=count;

    if(this.autoCommit)
      this.commitStatus();
  }

  markSteps(count){
    this.status.progress.count+=count;

    if(this.autoCommit)
      this.commitStatus();
  }

  complete(){
    this.status.progress.completed = true;
    this.status.progress.count = this.status.progress.total;

    if(this.autoCommit)
      this.commitStatus();
  }

  commitStatus(expire=120){
    CacheService.getUserCache().put(`OpsTracker:${this.operationId}`, JSON.stringify(this.status), expire);
  }

  loadStatus(){
    try {
      const statusJson = CacheService.getUserCache().get(`OpsTracker:${this.operationId}`);
      this.status = JSON.parse(statusJson) || {
        logs:[],
        progress: {
          count:0,
          total:0,
          completed: false
        }
      };
    }
    catch(ex){
      this.status = {
        logs:[],
        progress: {
          count:0,
          total:0,
          completed: false
        }
      };
    }
  }
}