
function doGet(e){
  return HtmlService
      .createTemplateFromFile('Index')
      .evaluate();
}

function archiveOldCourses(){
  var courses = Classroom.Courses.list({
    teacherId: "me",
    courseStates:["ACTIVE", "PROVISIONED", "DECLINED"]
  });
  
  courses.map(p=>archiveCourse_(p))
}

function getImportNewCoursesProgress(operationId){
  const trackedOp = OpsTracker.track(`ImportNewCourses:${operationId}`);
  
  return trackedOp.status;
}

function importNewCourses(formParams){

  const rollbackQueue=[];
  const trackedOp = OpsTracker.track(`ImportNewCourses:${formParams.operationId}`);

  try
  {
    const cvvClient = CvvService.clientFor(formParams.username);

    if (!cvvClient.signedIn() && !cvvClient.signIn(formParams.username, formParams.password)){
      throw new Error("Unable to login into Cvv");
    }

    const courses = cvvClient.getCourses();
    trackedOp.addSteps(courses.length);

    trackedOp.logInfo(`Found ${courses.length} courses`);

    trackedOp.commitStatus();

    const classroomFolder = getOrCreateFolder_(DriveApp.getRootFolder(), "Classroom");
    const schoolYearFolder = getOrCreateFolder_(classroomFolder, formParams.schoolYear);

    const studentsCache = {};

    courses.map(p => {
      const students = cvvClient.getStudents(p.classId);

      trackedOp.addSteps(students.length);
      trackedOp.commitStatus();
      
      trackedOp.logInfo(`Found ${students.length} students for the course: ${p.section} - ${p.subject}`);

      const sectionFolder = getOrCreateFolder_(schoolYearFolder, p.section);

      const course = Classroom.newCourse()
      course.name = p.subject;
      course.section = p.section;
      course.ownerId = "me";
      let  createdCourse = course;

      if(!formParams.testMode){
        let  createdCourse = Classroom.Courses.create(course);
        createdCourse = Classroom.Courses.get(createdCourse.id);

        rollbackQueue.push(()=>archiveAndDeleteCourse_(createdCourse));

        const folder = DriveApp.getFolderById(createdCourse.teacherFolder.id);
        folder.moveTo(sectionFolder);
        //TODO: evaluate if needed: folder.setName(course.name);
      }

      trackedOp.markSteps(1);
      
      trackedOp.logInfo(`Created course (${createdCourse.id}) ${createdCourse.section} - ${createdCourse.name}`);
      trackedOp.commitStatus();

      students.map((s, sIndex) => {

        let searchResults=[];
        if(!studentsCache[course.section] || !studentsCache[course.section][s.nameString]) {
          let people = {people:[]};
          let retryTime = 0;
          let retrySleepTime = 500;

          do{
            try{
              people = People.People.searchDirectoryPeople({
                query: s.nameString,
                readMask: "emailAddresses",
                sources: ["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE"]
              });
              break;
            }
            catch(ex){
              if(ex.details && ex.details.code == 429){
                Utilities.sleep(retrySleepTime);
                retryTime+=retrySleepTime;

                if(retryTime > 20000)
                  throw new Error(`Maximum retry time exceeded ${20}s. Persistent GoogleApi "quota exceeded" error.`);
              }
              else{
                throw ex;
              }
            }
          }while(true);

          if(!studentsCache[course.section])
            studentsCache[course.section]={};

          studentsCache[course.section][s.nameString] = people.people;
        }
        
        searchResults = studentsCache[course.section][s.nameString]
        
        if(searchResults.length==0){
          trackedOp.logWarn(`No profile found for ${s.nameString}`);
        }
        else if(searchResults.length>1){
          const joinedEmails = searchResults.map(p => p.emailAddresses[0].value).join(", ");
          trackedOp.logWarn(`More than one profile found for ${s.nameString}: ${joinedEmails}. Unable to invite to ${createdCourse.section} - ${createdCourse.name}`);
        }
        else {
          const userEmail = searchResults[0].emailAddresses[0].value
          trackedOp.logInfo(`Created invitation for ${userEmail} to the course ${createdCourse.id}`);

          if (!formParams.testMode){
            const invitation = Classroom.newInvitation();
            invitation.courseId = createdCourse.id;
            invitation.userId = userEmail;
            invitation.role = "STUDENT";
            
            const invitationSent = Classroom.Invitations.create(invitation);

            rollbackQueue.push(()=>Classroom.Invitations.remove(invitationSent.id));
          }

          trackedOp.markSteps(1);
        }

        if(sIndex%5==0)
          trackedOp.commitStatus();
      });

      trackedOp.commitStatus();
    });

    trackedOp.complete();
  }
  catch(ex){
    while(rollbackQueue.length>0){
      rollbackQueue.pop()();
    }

    throw ex;
  }
  finally {
    rollbackQueue.splice(0, rollbackQueue.length);
    trackedOp.commitStatus(10);
  }

  return trackedOp.status;
}