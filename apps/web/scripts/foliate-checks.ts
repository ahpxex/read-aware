import ts from 'typescript';

/** Strict mode alone permits contextual callback types and generic defaults containing any. */
export function checkFoliateTypes(program: ts.Program, files: readonly ts.SourceFile[]): ts.Diagnostic[] {
  const checker = program.getTypeChecker();
  const diagnostics: ts.Diagnostic[] = [];
  const containsAny = (type: ts.Type, seen = new Set<ts.Type>()): boolean => {
    if (type.flags & ts.TypeFlags.Any) return true;
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isUnionOrIntersection()) return type.types.some(item => containsAny(item, seen));
    if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
      return checker.getTypeArguments(type as ts.TypeReference).some(item => containsAny(item, seen));
    return false;
  };
  for (const file of files) {
    const fail = (node: ts.Node, messageText: string) => diagnostics.push({
      category: ts.DiagnosticCategory.Error, code: 99001, file,
      start: node.getStart(file), length: node.getWidth(file), messageText,
    });
    const walk = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) fail(node, 'Engine contracts must not use explicit any.');
      if (ts.isAsExpression(node) && ts.isAsExpression(node.expression)
          && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword)
        fail(node, 'Do not bypass engine contracts with a double assertion through unknown.');
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)
          || ts.isBindingElement(node) || ts.isPropertySignature(node) || ts.isPropertyAssignment(node))
          && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))) {
        const type = checker.getTypeAtLocation(node.name);
        if (containsAny(type)) fail(node.name, 'Engine binding contains inferred any: ' + checker.typeToString(type));
      }
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
          || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        if (signature && containsAny(signature.getReturnType())) fail(node, 'Engine function returns inferred any.');
      }
      ts.forEachChild(node, walk);
    };
    walk(file);
    if (/@ts-(?:ignore|nocheck|expect-error)\b/.test(file.text)) fail(file, 'Engine type errors must not be suppressed.');
  }
  return diagnostics;
}
