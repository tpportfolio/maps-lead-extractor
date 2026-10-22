import type { ReactNode } from "react";

type WindowProps = {
  title: string;
  status?: ReactNode;
  children: ReactNode;
  id?: string;
};

export default function Window({ title, status, children, id }: WindowProps) {
  return (
    <section className="vw" id={id}>
      <div className="vw-bar">
        <span className="vw-lights" aria-hidden="true">
          <span className="vw-light vw-light-r" />
          <span className="vw-light vw-light-y" />
          <span className="vw-light vw-light-g" />
        </span>
        <span className="vw-title">{title}</span>
      </div>
      <div className="vw-body">{children}</div>
      {status ? <div className="vw-foot">{status}</div> : null}
    </section>
  );
}
