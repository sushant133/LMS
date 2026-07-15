import { Bold, Italic, Link2, List, ListOrdered, Underline } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const RichTextEditor = ({
  value,
  onChange,
  placeholder,
  className,
}: RichTextEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const applyCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    onChange(editorRef.current?.innerHTML ?? "");
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL");
    if (url) applyCommand("createLink", url);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => applyCommand("bold")}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => applyCommand("italic")}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => applyCommand("underline")}
        >
          <Underline className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => applyCommand("insertUnorderedList")}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => applyCommand("insertOrderedList")}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Insert hyperlink"
          onClick={insertLink}
        >
          <Link2 className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        className="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
        onInput={() => onChange(editorRef.current?.innerHTML ?? "")}
        onBlur={() => onChange(editorRef.current?.innerHTML ?? "")}
        suppressContentEditableWarning
      />
    </div>
  );
};
