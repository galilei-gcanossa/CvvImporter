const APP_NAME = "CvvImporter";

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
  const trackedOp = CvvService.utils_getOperationTracker(`ImportNewCourses:${operationId}`);
  
  return trackedOp.getStatus();
}

function importNewCourses(formParams){

  const rollbackQueue=[];
  const trackedOp = CvvService.utils_getOperationTracker(`ImportNewCourses:${formParams.operationId}`);

  try
  {
    const account = CvvService.account_getActive("CvvImporter");

    const courses = CvvService.courses_get(account);
    trackedOp.addSteps(courses.length);

    trackedOp.logInfo(`Found ${courses.length} courses`);

    trackedOp.commit();

    const classroomFolder = getOrCreateFolder_(DriveApp.getRootFolder(), "Classroom");
    const schoolYearFolder = getOrCreateFolder_(classroomFolder, formParams.schoolYear);

    const studentsCache = {};

    courses.map(cvvCourse => {
      const students = CvvService.courses_getStudents(account, cvvCourse.classId);

      trackedOp.addSteps(students.length);
      trackedOp.commit();
      
      trackedOp.logInfo(`Found ${students.length} students for the course: ${cvvCourse.section} - ${cvvCourse.subject}`);

      const sectionFolder = getOrCreateFolder_(schoolYearFolder, cvvCourse.section);

      const course = Classroom.newCourse()
      course.name = cvvCourse.subject;
      course.section = cvvCourse.section;
      course.ownerId = "me";
      let  createdCourse = course;
      trackedOp.logInfo(`Preparing course (${createdCourse.id}) ${createdCourse.section} - ${createdCourse.name}`);

      if(!formParams.testMode){
        let existingCourses = Classroom.Courses.list({
          teacherId: "me",
          courseStates:["ACTIVE", "PROVISIONED", "DECLINED"]
        });
        existingCourses = (existingCourses.courses||[]).filter(t => t.name == cvvCourse.subject && t.section == cvvCourse.section);
        
        if(existingCourses.length==0){
          createdCourse = Classroom.Courses.create(course);
          createdCourse = Classroom.Courses.get(createdCourse.id);

          rollbackQueue.push(()=>archiveAndDeleteCourse_(createdCourse));

          Utilities.sleep(1000);
          try{
            const folder = DriveApp.getFolderById(createdCourse.teacherFolder.id);
            folder.moveTo(sectionFolder);
            //TODO: evaluate if needed: folder.setName(course.name);
          }
          catch(ex){
            trackedOp.logError(`Unable to move folder of the course ${createdCourse.name} to ${sectionFolder.getName()}. Proceed by hand.`)
          }

          trackedOp.logInfo(`Created course (${createdCourse.id}) ${createdCourse.section} - ${createdCourse.name}`);
        }
        else{
          createdCourse = existingCourses[0];
          trackedOp.logInfo(`Course (${createdCourse.id}) ${createdCourse.section} - ${createdCourse.name} already present.`);
        }
      }

      trackedOp.markSteps(1);
      
      trackedOp.commit();

      students.map((cvvStudent, sIndex) => {

        let searchResults=[];
        if(!studentsCache[course.section] || !studentsCache[course.section][cvvStudent.nameString]) {
          let people = {people:[]};
          let retryTime = 0;
          let retrySleepTime = 500;

          do{
            try{
              people = People.People.searchDirectoryPeople({
                query: cvvStudent.nameString,
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

          studentsCache[course.section][cvvStudent.nameString] = people.people || [];
        }
        
        searchResults = studentsCache[course.section][cvvStudent.nameString]
        
        if(searchResults.length==0){
          trackedOp.logWarn(`No profile found for ${cvvStudent.nameString}`);
        }
        else if(searchResults.length>1){
          const joinedEmails = searchResults.map(p => p.emailAddresses[0].value).join(", ");
          trackedOp.logWarn(`More than one profile found for ${cvvStudent.nameString}: ${joinedEmails}. Unable to invite to ${createdCourse.section} - ${createdCourse.name}`);
        }
        else {
          const userEmail = searchResults[0].emailAddresses[0].value
          trackedOp.logInfo(`Preparing invitation for ${userEmail} to the course ${createdCourse.id}`);

          if (!formParams.testMode){
            const existingInvitations = Classroom.Invitations.list({
              courseId:createdCourse.id, 
              userId: userEmail
            });

            if(existingInvitations.invitations && existingInvitations.invitations.filter(p => p.role == "STUDENT").length == 0){
              const invitation = Classroom.newInvitation();
              invitation.courseId = createdCourse.id;
              invitation.userId = userEmail;
              invitation.role = "STUDENT";
              
              const invitationSent = Classroom.Invitations.create(invitation);

              rollbackQueue.push(()=>Classroom.Invitations.remove(invitationSent.id));
              trackedOp.logInfo(`Created invitation for ${userEmail} to the course ${createdCourse.id}`);
            }
            else {
              trackedOp.logInfo(`Invitation for ${userEmail} to the course ${createdCourse.id} already sent.`);
            }
          }

          trackedOp.markSteps(1);
        }

        if(sIndex%5==0)
          trackedOp.commit();
      });

      trackedOp.commit();
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
    trackedOp.commit(10);
  }

  return trackedOp.getStatus();
}