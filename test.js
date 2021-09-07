function test_clearTestCourses_(){
  var courses = Classroom.Courses.list({
    teacherId: "me"
  });
  courses = courses.courses.filter(p => p.section && p.section.startsWith("__"));
  console.log(courses)
  courses.map(p=>archiveAndDeleteCourse_(p))
}