"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AddLocationDialogProps {
  defaultLabel: string;
  onConfirm: (label: string) => void | Promise<void>;
  trigger: React.ReactNode;
}

export function AddLocationDialog({ defaultLabel, onConfirm, trigger }: AddLocationDialogProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(defaultLabel);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setLabel(defaultLabel);
      }}
    >
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="rounded-none">
        <DialogHeader>
          <DialogTitle>Save this location</DialogTitle>
          <DialogDescription>It'll show up in your saved-locations list for one-click switching.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="location-label">Name</Label>
          <Input id="location-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button
            disabled={!label.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm(label.trim());
                setOpen(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
