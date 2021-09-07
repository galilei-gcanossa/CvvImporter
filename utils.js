
function getOrCreateFolder_(parentFolder, name){
  const result = parentFolder.getFoldersByName(name);
  
  if(result.hasNext())
    return result.next();
  else
    return parentFolder.createFolder(name);
}

function archiveCourse_(course){
  Classroom.Courses.update({...course, courseState: "ARCHIVED"}, course.id);
}

function archiveAndDeleteCourse_(course){
  Classroom.Courses.update({...course, courseState: "ARCHIVED"}, course.id);
  Classroom.Courses.remove(course.id);
  DriveApp.getFolderById(course.teacherFolder.id).setTrashed(true);
}