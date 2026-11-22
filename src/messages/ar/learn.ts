// شاشات التعلّم (المخطط §6، LRN-01 إلى LRN-04) وشاشات المحتوى لفريق المنصة.
const learn: Record<string, string> = {
  // نُقلت مع مكوّنات الدروس من التطبيق الاستهلاكي @720f174 (src/messages/ar/learn.ts).
  'course.checkpoint_title': 'نقطة مراجعة',
  'course.quiz_answered': 'أجبت عن {answered} من {total}',
  'course.quiz_correct': 'إجابة صحيحة',
  'course.quiz_incorrect': 'إجابة غير صحيحة',
  'course.quiz_passed': 'اجتزت نقطة المراجعة!',
  'course.quiz_passed_sub': 'اعتُبر القسم مكتملاً — واصل التقدم.',
  'course.quiz_failed': 'اقتربت — راجع التوضيحات وحاول مرة أخرى.',
  'course.quiz_retry': 'حاول مجدداً',
};

export default learn;
